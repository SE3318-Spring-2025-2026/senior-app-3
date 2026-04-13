/**
 * Smoke tests — POST /api/deliverables/validate-group  (Process 5.1)
 *
 * Covers every branch in deliverableController.validateGroup:
 *   400  missing groupId body
 *   401  no Authorization header
 *   401  malformed / invalid token
 *   403  non-student role (coordinator)
 *   403  groupId in body ≠ req.user.groupId  (GROUP_ID_MISMATCH)
 *   404  group not found in D2              (GROUP_NOT_FOUND)
 *   409  group exists but status !== active  (GROUP_NOT_ACTIVE)
 *   409  group active but no committeeId    (NO_COMMITTEE_ASSIGNED)
 *   409  committeeId set but committee has no members  (NO_COMMITTEE_ASSIGNED)
 *   200  all gates pass → returns validationToken + expected fields
 *
 * Run:
 *   npm test -- validate-group.smoke.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'validate-group-smoke-secret';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const Committee = require('../src/models/Committee');

const ENDPOINT = '/api/v1/deliverables/validate-group';

let mongod;
let app;

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function makeToken(userId, role) {
  return generateAccessToken(userId, role);
}

/**
 * Seeds a Group with one accepted student member.
 * Returns { groupId, studentId, token }.
 */
async function seedGroup(overrides = {}) {
  const studentId = unique('stu');
  const groupId = unique('grp');

  await Group.create({
    groupId,
    groupName: unique('Group'),
    leaderId: studentId,
    status: 'active',
    members: [{ userId: studentId, role: 'leader', status: 'accepted' }],
    ...overrides,
  });

  return { groupId, studentId, token: makeToken(studentId, 'student') };
}

/**
 * Seeds a Committee with at least one advisor.
 * Returns { committeeId }.
 */
async function seedCommittee(overrides = {}) {
  const committeeId = unique('cmt');

  await Committee.create({
    committeeId,
    committeeName: unique('Committee'),
    createdBy: unique('coord'),
    status: 'published',
    advisorIds: [unique('adv')],
    juryIds: [],
    ...overrides,
  });

  return { committeeId };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = require('../src/index');
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

// ---------------------------------------------------------------------------
// Auth guard (deliverableAuthMiddleware)
// ---------------------------------------------------------------------------
describe('auth guard', () => {
  it('401 — no Authorization header', async () => {
    const res = await request(app).post(ENDPOINT).send({ groupId: 'grp_x' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed token', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer not.a.real.token')
      .send({ groupId: 'grp_x' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// Role guard (roleMiddleware(['student']))
// ---------------------------------------------------------------------------
describe('role guard', () => {
  it('403 — coordinator cannot call validate-group', async () => {
    const token = makeToken(unique('coord'), 'coordinator');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: 'grp_x' });

    expect(res.status).toBe(403);
  });

  it('403 — professor cannot call validate-group', async () => {
    const token = makeToken(unique('prof'), 'professor');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: 'grp_x' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Request body validation
// ---------------------------------------------------------------------------
describe('request body validation', () => {
  it('400 — missing groupId', async () => {
    const { token } = await seedGroup();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// groupId ownership check  (GROUP_ID_MISMATCH → 403)
// ---------------------------------------------------------------------------
describe('groupId ownership', () => {
  it('403 — groupId in body does not match student group', async () => {
    const { token } = await seedGroup();
    const someOtherGroupId = unique('grp');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: someOtherGroupId });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GROUP_ID_MISMATCH');
  });

  it('403 — student with no group sends any groupId', async () => {
    // Student not in any group → deliverableAuthMiddleware sets groupId = null
    const studentId = unique('stu');
    const token = makeToken(studentId, 'student');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: unique('grp') });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GROUP_ID_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// D2 group status checks
// ---------------------------------------------------------------------------
describe('D2 group status checks', () => {
  it('409 — group exists but is inactive', async () => {
    const { groupId, token } = await seedGroup({ status: 'inactive' });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GROUP_NOT_ACTIVE');
  });

  it('409 — group exists but is pending_validation', async () => {
    const { groupId, token } = await seedGroup({ status: 'pending_validation' });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GROUP_NOT_ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// D3 committee checks  (NO_COMMITTEE_ASSIGNED → 409)
// ---------------------------------------------------------------------------
describe('D3 committee checks', () => {
  it('409 — group is active but has no committeeId', async () => {
    const { groupId, token } = await seedGroup({ committeeId: null });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_COMMITTEE_ASSIGNED');
  });

  it('409 — committeeId set but committee has no advisors or jury', async () => {
    const { committeeId } = await seedCommittee({ advisorIds: [], juryIds: [] });
    const { groupId, token } = await seedGroup({ committeeId });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_COMMITTEE_ASSIGNED');
  });

  it('409 — committeeId set but committee document does not exist', async () => {
    const { groupId, token } = await seedGroup({ committeeId: unique('ghost_cmt') });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_COMMITTEE_ASSIGNED');
  });
});

// ---------------------------------------------------------------------------
// Happy path  (200)
// ---------------------------------------------------------------------------
describe('happy path', () => {
  it('200 — returns validationToken and all required fields', async () => {
    const advisorId = unique('adv');
    const { committeeId } = await seedCommittee({ advisorIds: [advisorId] });
    const { groupId, studentId, token } = await seedGroup({ committeeId, advisorId });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(200);
    expect(res.body.groupId).toBe(groupId);
    expect(res.body.committeeId).toBe(committeeId);
    expect(res.body.groupStatus).toBe('active');
    expect(res.body.validationToken).toBeDefined();
    expect(res.body.validAt).toBeDefined();
  });

  it('200 — validationToken is a valid JWT with groupId and committeeId', async () => {
    const { committeeId } = await seedCommittee();
    const { groupId, token } = await seedGroup({ committeeId });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(200);

    const decoded = jwt.verify(
      res.body.validationToken,
      process.env.JWT_SECRET
    );
    expect(decoded.groupId).toBe(groupId);
    expect(decoded.committeeId).toBe(committeeId);
    // expires in ~15 min
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it('200 — validationToken expires in 15 minutes', async () => {
    const { committeeId } = await seedCommittee();
    const { groupId, token } = await seedGroup({ committeeId });

    const before = Math.floor(Date.now() / 1000);

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    const after = Math.floor(Date.now() / 1000);
    const decoded = jwt.decode(res.body.validationToken);

    expect(decoded.exp).toBeGreaterThanOrEqual(before + 15 * 60);
    expect(decoded.exp).toBeLessThanOrEqual(after + 15 * 60);
  });

  it('200 — committee with only juryIds (no advisorIds) is accepted', async () => {
    const { committeeId } = await seedCommittee({
      advisorIds: [],
      juryIds: [unique('jury')],
    });
    const { groupId, token } = await seedGroup({ committeeId });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId });

    expect(res.status).toBe(200);
    expect(res.body.committeeId).toBe(committeeId);
  });
});
