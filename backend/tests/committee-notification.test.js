/**
 * Issue #92 — Committee publication notification integration
 *
 * - supertest (`request(app)`) against real Express app
 * - MongoMemoryReplSet for `withTransaction`
 *
 * Mocking strategy: `jest.mock('axios')` simulates the Notification Service HTTP API.
 * The production `dispatchCommitteePublishNotification` implementation (including
 * `retryNotificationWithBackoff` and SyncErrorLog on exhaustion) stays fully
 * exercised. Mocking `notificationService` wholesale would bypass retry logic and
 * invalidate call-count assertions.
 *
 * Graceful degradation: all notification attempts fail → HTTP 200,
 * `notificationTriggered: false` (never 503); D3 publish transaction still committed.
 *
 * Run: npm test -- committee-notification.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-jwt-secret';

jest.mock('axios', () => ({
  post: jest.fn(),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const axios = require('axios');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');

const Committee = require('../src/models/Committee');
const Group = require('../src/models/Group');
const SyncErrorLog = require('../src/models/SyncErrorLog');

let mongoReplSet;
let app;

const API = '/api/v1';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function tokenCoordinator(userId = unique('coord')) {
  return { userId, token: generateAccessToken(userId, 'coordinator') };
}

async function clearAllCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/** Build a 500-style axios error classified as transient by notificationRetry.isTransientError */
function transientServerError() {
  const err = new Error('Request failed with status code 500');
  err.response = { status: 500, data: { message: 'upstream' } };
  return err;
}

/**
 * Seeds validated committee + groups; returns ids for publish body and expected recipient union.
 * Recipient union: unique advisorIds ∪ juryIds ∪ group member userIds (deduped).
 */
async function seedValidatedCommitteeForPublish(httpApp) {
  const coord = tokenCoordinator();

  const advA = unique('adv_a');
  const advB = unique('adv_b');
  const jur1 = unique('jur_1');
  const jur2 = unique('jur_2');
  const stuD = unique('stu_d');
  const stuE = unique('stu_e');

  const groupId = unique('grp');

  const createRes = await request(httpApp)
    .post(`${API}/committees`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ committeeName: unique('Notif Committee'), description: 'issue 92' });
  expect(createRes.status).toBe(201);
  const committeeId = createRes.body.committeeId;

  await request(httpApp)
    .post(`${API}/committees/${committeeId}/advisors`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ advisorIds: [advA, advB] });

  await request(httpApp)
    .post(`${API}/committees/${committeeId}/jury`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ juryIds: [jur1, jur2] });

  await Group.create({
    groupId,
    groupName: unique('GName'),
    leaderId: stuD,
    status: 'active',
    members: [
      { userId: advA, role: 'member', status: 'accepted' },
      { userId: stuD, role: 'leader', status: 'accepted' },
      { userId: stuE, role: 'member', status: 'accepted' },
    ],
  });

  const valRes = await request(httpApp)
    .post(`${API}/committees/${committeeId}/validate`)
    .set('Authorization', `Bearer ${coord.token}`);
  expect(valRes.status).toBe(200);
  expect(valRes.body.valid).toBe(true);

  /** Union of advisors, jury, and group member userIds (advA appears as advisor and member) */
  const expectedRecipients = Array.from(new Set([advA, advB, jur1, jur2, stuD, stuE])).sort();

  return {
    coord,
    committeeId,
    groupId,
    expectedRecipients,
  };
}

describe('Issue #92 — committee publish notification integration', () => {
  beforeAll(async () => {
    mongoReplSet = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    await mongoose.connect(mongoReplSet.getUri());
    app = require('../src/index');
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoReplSet) await mongoReplSet.stop();
  });

  beforeEach(() => {
    axios.post.mockReset();
  });

  afterEach(async () => {
    await clearAllCollections();
    jest.clearAllMocks();
  });

  describe('Test setup & mocking', () => {
    it('uses MongoMemoryReplSet and mocks axios (Notification Service transport)', () => {
      expect(mongoReplSet).toBeDefined();
      expect(mongoReplSet.getUri()).toMatch(/^mongodb/);
      expect(jest.isMockFunction(axios.post)).toBe(true);
    });
  });

  describe('Success path and recipient aggregation', () => {
    it('returns 200, notificationTriggered true, and sends deduped recipients to Notification Service', async () => {
      axios.post.mockResolvedValue({
        data: { notification_id: 'notif_ok_1' },
      });

      const { coord, committeeId, groupId, expectedRecipients } = await seedValidatedCommitteeForPublish(app);

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [groupId] });

      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(true);
      expect(res.body.committeeId).toBe(committeeId);
      expect(res.body.status).toBe('published');

      expect(axios.post).toHaveBeenCalledTimes(1);
      const [url, body] = axios.post.mock.calls[0];
      expect(url).toContain('/api/notifications');
      expect(body.type).toBe('committee_published');
      expect(body.committeeId).toBe(committeeId);

      const c = await Committee.findOne({ committeeId }).lean();
      expect(c.committeeName).toBeTruthy();
      expect(body.committeeName).toBe(c.committeeName);
      expect(typeof body.publishedAt).toBe('string');
      expect(body.publishedBy).toBe(coord.userId);

      const recipients = [...(body.recipients || [])].sort();
      expect(recipients).toEqual(expectedRecipients);

      const g = await Group.findOne({ groupId }).lean();
      expect(g.committeeId).toBe(committeeId);
    });
  });

  describe('Retry logic (transient failures)', () => {
    it('succeeds on 3rd attempt after two transient 500s and calls axios.post 3 times', async () => {
      let n = 0;
      axios.post.mockImplementation(() => {
        n += 1;
        if (n < 3) {
          return Promise.reject(transientServerError());
        }
        return Promise.resolve({ data: { notification_id: 'notif_retry_ok' } });
      });

      const { coord, committeeId, groupId } = await seedValidatedCommitteeForPublish(app);

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [groupId] });

      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(3);
    }, 20000);
  });

  describe('Exhaustion and graceful degradation', () => {
    it('returns 200 with notificationTriggered false, 3 axios attempts, and SyncErrorLog with committeeId', async () => {
      axios.post.mockRejectedValue(transientServerError());

      const { coord, committeeId, groupId } = await seedValidatedCommitteeForPublish(app);

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [groupId] });

      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(false);
      expect(res.status).not.toBe(503);

      expect(axios.post).toHaveBeenCalledTimes(3);

      const c = await Committee.findOne({ committeeId }).lean();
      expect(c.status).toBe('published');

      const syncErr = await SyncErrorLog.findOne({ service: 'notification' }).lean();
      expect(syncErr).toBeTruthy();
      expect(syncErr.lastError).toContain(committeeId);
      const parsed = JSON.parse(syncErr.lastError);
      expect(parsed.committeeId).toBe(committeeId);
    }, 20000);
  });
});
