/**
 * Issue #246 — Resilience & Concurrency Integration Suite
 *
 * Run: npm test -- resilience-sync.test.js
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'resilience-sync-test-secret';

jest.mock('axios');
const axios = require('axios');
jest.mock(
  'swagger-ui-express',
  () => ({ serve: [], setup: () => (req, res, next) => next() }),
  { virtual: true }
);
jest.mock('../src/swagger', () => ({}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../src/index');
const Group = require('../src/models/Group');
const SprintRecord = require('../src/models/SprintRecord');
const GitHubSyncJob = require('../src/models/GitHubSyncJob');
const SyncErrorLog = require('../src/models/SyncErrorLog');
const { encrypt } = require('../src/utils/cryptoUtils');
const { generateAccessToken } = require('../src/utils/jwt');

const API = '/api/v1';
const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

let mongod;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clearState() {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((c) => c.deleteMany({})));
  jest.clearAllMocks();
  if (axios.get.mockReset) axios.get.mockReset();
}

async function waitForGitHubJobToSettle(jobId, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await GitHubSyncJob.findOne({ jobId }).lean();
    if (job && !['PENDING', 'IN_PROGRESS'].includes(job.status)) {
      return job;
    }
    await sleep(100);
  }
  return GitHubSyncJob.findOne({ jobId }).lean();
}

async function seedLeaderGroup(overrides = {}) {
  const groupId = overrides.groupId || unique('grp');
  const leaderId = overrides.leaderId || unique('leader');
  const group = await Group.create({
    groupId,
    groupName: unique('Group'),
    leaderId,
    status: 'active',
    members: [{ userId: leaderId, role: 'leader', status: 'accepted' }],
    ...overrides.groupFields,
  });
  return { group, groupId, leaderId };
}

async function seedGitHubReady(groupId) {
  await Group.updateOne(
    { groupId },
    {
      $set: {
        githubOrg: 'test-org',
        githubOrgId: 1,
        githubOrgName: 'Test Org',
        githubRepoName: 'test-repo',
        githubRepoUrl: 'https://github.com/test-org/test-repo',
        githubPat: encrypt('ghp_test_pat'),
      },
    }
  );
}

async function seedSprint(groupId, sprintId, deliverableId = 'DEL-1') {
  await SprintRecord.create({
    sprintId,
    groupId,
    committeeId: unique('comm'),
    committeeAssignedAt: new Date(),
    deliverableRefs: [{ deliverableId, type: 'proposal', submittedAt: new Date() }],
    status: 'in_progress',
  });
}

describe('Issue #246 — Resilience & Concurrency', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await GitHubSyncJob.init();
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    await clearState();
  });

  it('JIRA resilience: retries 3x and succeeds on 4th attempt', async () => {
    // AC-1: First 3 upstream attempts fail (timeout/503), 4th succeeds and integration is persisted.
    const { groupId, leaderId } = await seedLeaderGroup();
    const token = generateAccessToken(leaderId, 'student');

    let myselfCalls = 0;
    axios.get.mockImplementation((url) => {
      // /myself should fail transiently first 3 times, then pass.
      if (url.includes('/myself')) {
        myselfCalls += 1;
      }
      if (url.includes('/myself') && myselfCalls <= 3) {
        const err = new Error('Service Unavailable');
        err.response = { status: 503 };
        return Promise.reject(err);
      }
      if (url.includes('/myself')) {
        return Promise.resolve({ status: 200, data: { accountId: 'acc-1' } });
      }
      if (url.includes('/project/')) {
        return Promise.resolve({ status: 200, data: { id: '10001', key: 'PROJ', name: 'Project' } });
      }
      return Promise.resolve({ status: 200, data: {} });
    });

    const res = await request(app)
      .post(`${API}/groups/${groupId}/jira`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        host: 'https://example.atlassian.net',
        email: 'lead@example.com',
        api_token: 'jira_token',
        project_key: 'PROJ',
      });

    expect(myselfCalls).toBe(4);
    expect(res.status).toBe(201);
    expect(res.body.binding).toBe('confirmed');
  });

  it('Terminal failure: upstream 502/504 ends with FAILED + provider error code on job', async () => {
    // AC-2 + Zero-Trust: do not stop at 202; wait worker completion and assert final D6 failure state.
    const { groupId } = await seedLeaderGroup();
    await seedGitHubReady(groupId);
    const sprintId = unique('spr');
    await seedSprint(groupId, sprintId, 'DEL-TERMINAL');
    const token = generateAccessToken(unique('coord'), 'coordinator');

    axios.get.mockImplementation(() => {
      const err = new Error('Bad Gateway');
      err.response = { status: 502 };
      return Promise.reject(err);
    });

    const accepted = await request(app)
      .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
      .set('Authorization', `Bearer ${token}`);

    expect(accepted.status).toBe(202);
    const finalJob = await waitForGitHubJobToSettle(accepted.body.job_id, 10000);
    expect(finalJob).toBeTruthy();
    expect(finalJob.status).toBe('FAILED');
    expect(['UPSTREAM_PROVIDER_ERROR', 'GATEWAY_TIMEOUT']).toContain(finalJob.errorCode);
  }, 20000);

  it('Backoff + jitter: retry intervals are non-deterministic', async () => {
    // AC-3: prove retry delays are not fixed powers (must include jitter).
    const { groupId, leaderId } = await seedLeaderGroup();
    const token = generateAccessToken(leaderId, 'student');
    const randomSpy = jest.spyOn(Math, 'random');

    const timestamps = [];
    axios.get.mockImplementation((url) => {
      if (!url.includes('/myself')) {
        return Promise.resolve({ status: 200, data: { id: '10001', key: 'PROJ', name: 'Project' } });
      }
      timestamps.push(Date.now());
      if (timestamps.length <= 3) {
        const err = new Error('timeout');
        err.code = 'ECONNABORTED';
        return Promise.reject(err);
      }
      return Promise.resolve({ status: 200, data: { accountId: 'acc-1' } });
    });

    try {
      await request(app)
        .post(`${API}/groups/${groupId}/jira`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          host: 'https://example.atlassian.net',
          email: 'lead@example.com',
          api_token: 'jira_token',
          project_key: 'PROJ',
        });

      expect(timestamps.length).toBeGreaterThanOrEqual(4);
      // Directly validate jitter hook usage to reduce wall-clock flakiness.
      expect(randomSpy).toHaveBeenCalledTimes(3);
    } finally {
      randomSpy.mockRestore();
    }
  }, 20000);

  it('Race condition trap: parallel POST returns one 202 and one 409', async () => {
    // AC-4 + Zero-Trust: trigger same lock key concurrently and verify strict split (202/409).
    const { groupId } = await seedLeaderGroup();
    await seedGitHubReady(groupId);
    const sprintId = unique('spr');
    await seedSprint(groupId, sprintId, 'DEL-RACE');
    const token = generateAccessToken(unique('coord'), 'coordinator');

    axios.get.mockResolvedValue({ data: [] });

    const [r1, r2] = await Promise.all([
      request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([202, 409]);
  });

  it('Lock integrity: conflict is enforced by unique partial index', async () => {
    // AC-5: verify DB-level guarantee exists (not only in-memory/flag guard).
    const indexes = await GitHubSyncJob.collection.indexes();
    const lockIndex = indexes.find((idx) => {
      const key = idx.key || {};
      return (
        key.groupId === 1 &&
        key.sprintId === 1 &&
        Object.keys(key).length === 2 &&
        idx.unique === true &&
        JSON.stringify(idx.partialFilterExpression) === JSON.stringify({ status: 'IN_PROGRESS' })
      );
    });

    expect(lockIndex).toBeTruthy();
    expect(lockIndex.unique).toBe(true);
    expect(lockIndex.partialFilterExpression).toEqual({ status: 'IN_PROGRESS' });
  });

  it('Isolation sanity: database and mock state start clean each test', async () => {
    // AC-Isolation: explicit guard that test harness resets DB and mocks.
    const jobs = await GitHubSyncJob.countDocuments({});
    const logs = await SyncErrorLog.countDocuments({});
    expect(jobs).toBe(0);
    expect(logs).toBe(0);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
