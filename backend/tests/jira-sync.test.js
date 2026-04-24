'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jira-sync-test-secret';

jest.mock('axios');
const axios = require('axios');

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const { encrypt } = require('../src/utils/cryptoUtils');
const Group = require('../src/models/Group');
const SprintConfig = require('../src/models/SprintConfig');
const SprintIssue = require('../src/models/SprintIssue');
const JiraSyncJob = require('../src/models/JiraSyncJob');
const SyncErrorLog = require('../src/models/SyncErrorLog');
const { enqueueEligibleSyncs, stopJiraSyncScheduler } = require('../src/services/jiraSyncScheduler');

let mongod;
let app;

const API = '/api/v1';
const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function tokenFor(role, userId = unique(role)) {
  return { userId, token: generateAccessToken(userId, role) };
}

async function clearAllCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

async function seedJiraGroup(overrides = {}) {
  const groupId = overrides.groupId || unique('grp');
  const leaderId = overrides.leaderId || unique('lead');

  const group = await Group.create({
    groupId,
    groupName: unique('GroupJira'),
    leaderId,
    status: 'active',
    members: [{ userId: leaderId, role: 'leader', status: 'accepted' }],
    jiraUrl: 'https://example.atlassian.net',
    jiraUsername: 'jira@example.com',
    jiraToken: encrypt('jira-token'),
    projectKey: 'SPM',
    ...overrides.groupFields,
  });

  return { group, groupId, leaderId };
}

async function seedSprintConfig(groupId, sprintId, overrides = {}) {
  return SprintConfig.create({
    groupId,
    sprintId,
    deliverableType: 'proposal',
    deadline: overrides.deadline || new Date(Date.now() + 60_000),
    configurationStatus: overrides.configurationStatus || 'published',
    publishedAt: overrides.publishedAt || new Date(),
    externalSprintKey: overrides.externalSprintKey || 'Sprint 12',
    description: overrides.description || 'test sprint',
  });
}

async function waitForJobToSettle(jobId, maxMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const job = await JiraSyncJob.findOne({ jobId }).lean();
    if (job && !['PENDING', 'IN_PROGRESS'].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return JiraSyncJob.findOne({ jobId }).lean();
}

describe('Process 7.1 - JIRA Sprint Sync', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = require('../src/index');
  }, 60000);

  afterAll(async () => {
    stopJiraSyncScheduler();
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  afterEach(async () => {
    await clearAllCollections();
    jest.clearAllMocks();
    axios.get.mockReset && axios.get.mockReset();
  });

  describe('POST /groups/:groupId/sprints/:sprintId/jira-sync', () => {
    it('returns 401 when authorization is missing', async () => {
      const res = await request(app).post(`${API}/groups/grp_x/sprints/spr_x/jira-sync`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-coordinator callers', async () => {
      const { token } = tokenFor('student');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId);

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 422 when no published sprint config exists', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('SPRINT_CONFIG_NOT_PUBLISHED');
    });

    it('returns 422 when config exists but is still draft', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId, { configurationStatus: 'draft' });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('SPRINT_CONFIG_NOT_PUBLISHED');
    });

    it('returns 202 with queued status for a valid request', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId);

      axios.get
        .mockResolvedValueOnce({
          data: [{ id: 'customfield_10016', name: 'Story Points' }],
        })
        .mockResolvedValueOnce({
          data: { issues: [] },
        });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBeTruthy();
      expect(res.body.status).toBe('queued');
      expect(res.body.source).toBe('jira');
    });

    it('returns 409 when a sync job is already active', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId);
      await JiraSyncJob.create({ groupId, sprintId, status: 'IN_PROGRESS', triggeredBy: 'coord_seed' });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SYNC_ALREADY_RUNNING');
    });

    it('persists sprint issues into D6 after a successful sync', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId, { externalSprintKey: 'Sprint Alpha' });

      axios.get
        .mockResolvedValueOnce({
          data: [{ id: 'customfield_10016', name: 'Story Points' }],
        })
        .mockResolvedValueOnce({
          data: {
            issues: [
              {
                key: 'SPM-101',
                fields: {
                  customfield_10016: 5,
                  status: { name: 'Done' },
                  assignee: { accountId: 'acc_1', displayName: 'Alice' },
                },
              },
              {
                key: 'SPM-102',
                fields: {
                  customfield_10016: 3,
                  status: { name: 'In Progress' },
                  assignee: { accountId: 'acc_2', displayName: 'Bob' },
                },
              },
            ],
          },
        });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      const settled = await waitForJobToSettle(res.body.jobId);
      const issues = await SprintIssue.find({ groupId, sprintId }).sort({ issueKey: 1 }).lean();

      expect(settled.status).toBe('COMPLETED');
      expect(issues).toHaveLength(2);
      expect(issues[0].issueKey).toBe('SPM-101');
      expect(issues[0].storyPoints).toBe(5);
      expect(issues[1].issueKey).toBe('SPM-102');
      expect(issues[1].assigneeDisplayName).toBe('Bob');
    });

    it('retries transient upstream errors and eventually succeeds', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId);

      let attempts = 0;
      const transientError = Object.assign(new Error('Service Unavailable'), {
        response: { status: 503 },
      });

      axios.get = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts <= 2) {
          return Promise.reject(transientError);
        }
        if (attempts === 3) {
          return Promise.resolve({
            data: [{ id: 'customfield_10016', name: 'Story Points' }],
          });
        }
        return Promise.resolve({ data: { issues: [] } });
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      const settled = await waitForJobToSettle(res.body.jobId, 8000);

      expect(settled.status).toBe('COMPLETED');
      expect(attempts).toBeGreaterThanOrEqual(4);
    }, 12000);

    it('marks the job failed with gateway timeout and writes SyncErrorLog after retry exhaustion', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId);

      const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
      axios.get = jest.fn().mockRejectedValue(timeoutError);

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      const settled = await waitForJobToSettle(res.body.jobId, 8000);
      const syncErr = await SyncErrorLog.findOne({ groupId, service: 'jira' }).lean();

      expect(settled.status).toBe('FAILED');
      expect(settled.errorCode).toBe('GATEWAY_TIMEOUT');
      expect(syncErr).toBeTruthy();
    }, 12000);

    it('marks the job failed with upstream provider error on persistent 5xx failures', async () => {
      const { token } = tokenFor('coordinator');
      const { groupId } = await seedJiraGroup();
      const sprintId = unique('spr');
      await seedSprintConfig(groupId, sprintId);

      const serverError = Object.assign(new Error('bad gateway'), {
        response: { status: 503 },
      });
      axios.get = jest.fn().mockRejectedValue(serverError);

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/jira-sync`)
        .set('Authorization', `Bearer ${token}`);

      const settled = await waitForJobToSettle(res.body.jobId, 8000);

      expect(settled.status).toBe('FAILED');
      expect(settled.errorCode).toBe('UPSTREAM_PROVIDER_ERROR');
    }, 12000);
  });

  describe('scheduler', () => {
    it('enqueues only published, non-expired configs', async () => {
      const { groupId } = await seedJiraGroup({ groupId: 'grp_sched_a' });
      const sprintId = 'spr_sched_a';
      await seedSprintConfig(groupId, sprintId);
      await seedSprintConfig('grp_sched_b', 'spr_sched_b', {
        configurationStatus: 'draft',
      });
      await seedSprintConfig('grp_sched_c', 'spr_sched_c', {
        deadline: new Date(Date.now() - 60_000),
      });

      axios.get
        .mockResolvedValueOnce({ data: [{ id: 'customfield_10016', name: 'Story Points' }] })
        .mockResolvedValueOnce({ data: { issues: [] } });

      await enqueueEligibleSyncs();

      const jobs = await JiraSyncJob.find({}).lean();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].groupId).toBe(groupId);
      expect(jobs[0].sprintId).toBe(sprintId);
    });

    it('is idempotent when an active lock already exists', async () => {
      const { groupId } = await seedJiraGroup({ groupId: 'grp_sched_lock' });
      const sprintId = 'spr_sched_lock';
      await seedSprintConfig(groupId, sprintId);
      await JiraSyncJob.create({
        groupId,
        sprintId,
        status: 'IN_PROGRESS',
        triggeredBy: 'system',
      });

      await enqueueEligibleSyncs();

      const jobs = await JiraSyncJob.find({ groupId, sprintId }).lean();
      expect(jobs).toHaveLength(1);
    });
  });
});
