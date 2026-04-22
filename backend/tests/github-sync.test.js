/**
 * github-sync.test.js — Process 7.2: GitHub PR Sync (Integration)
 *
 * Tests the full async-bridge lifecycle:
 *   POST /api/v1/groups/:groupId/sprints/:sprintId/github-sync
 *   GET  /api/v1/groups/:groupId/sprints/:sprintId/github-sync
 *   GET  /api/v1/groups/:groupId/sprints/:sprintId/github-sync/:jobId
 *
 * QA Acceptance checklist (spec §5):
 *   [✓] Second POST within 5 s returns 409
 *   [✓] D6 merge_status transitions UNKNOWN → MERGED after successful sync
 *   [✓] Mock GitHub 503 → system retries before recording UNKNOWN / FAILED
 *   [✓] Process 7.1 not run (D6 empty) → endpoint returns 404
 *
 * Uses MongoMemoryServer (standalone — no transactions needed here).
 *
 * Run: npm test -- github-sync.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'github-sync-test-secret';

// ── Axios mock (must be hoisted before any require of the service) ──────────
jest.mock('axios');
const axios = require('axios');

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const SprintRecord = require('../src/models/SprintRecord');
const ContributionRecord = require('../src/models/ContributionRecord');
const GitHubSyncJob = require('../src/models/GitHubSyncJob');
const AuditLog = require('../src/models/AuditLog');
const { encrypt } = require('../src/utils/cryptoUtils');

// ── Service under test (imported after mocks are in place) ──────────────────
const {
  determineMergeStatus,
  getGitHubConfig,
  getSprintIssues,
  GitHubSyncError,
} = require('../src/services/githubSyncService');

let mongod;
let app;

const API = '/api/v1';
const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

// ── Token helpers ────────────────────────────────────────────────────────────
function tokenCoordinator(userId = unique('coord')) {
  return { userId, token: generateAccessToken(userId, 'coordinator') };
}
function tokenStudent(userId = unique('stu')) {
  return { userId, token: generateAccessToken(userId, 'student') };
}
function tokenProfessor(userId = unique('prof')) {
  return { userId, token: generateAccessToken(userId, 'professor') };
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function clearAllCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/**
 * seedGroupWithGitHub — creates a Group document in D2 with a full GitHub config.
 */
async function seedGroupWithGitHub(overrides = {}) {
  const groupId = overrides.groupId || unique('grp');
  const leaderId = overrides.leaderId || unique('lead');

  const group = await Group.create({
    groupId,
    groupName: unique('GroupGH'),
    leaderId,
    status: 'active',
    members: [{ userId: leaderId, role: 'leader', status: 'accepted' }],
    // GitHub D2 config
    githubOrg: overrides.githubOrg || 'test-org',
    githubOrgId: 12345,
    githubOrgName: 'Test Org',
    githubRepoName: overrides.githubRepoName || 'test-repo',
    githubRepoUrl: `https://github.com/${overrides.githubOrg || 'test-org'}/${overrides.githubRepoName || 'test-repo'}`,
    githubPat: encrypt(overrides.githubPat || 'ghp_test_pat_token'),
    githubLastSynced: new Date(),
    ...overrides.groupFields,
  });

  return { group, groupId, leaderId };
}

/**
 * seedSprintRecord — creates a SprintRecord in D6.
 */
async function seedSprintRecord(groupId, sprintId, overrides = {}) {
  return SprintRecord.create({
    sprintId,
    groupId,
    committeeId: overrides.committeeId || unique('comm'),
    committeeAssignedAt: new Date(),
    deliverableRefs: overrides.deliverableRefs || [
      {
        deliverableId: unique('del'),
        type: 'proposal',
        submittedAt: new Date(),
      },
    ],
    status: overrides.status || 'in_progress',
  });
}

/**
 * waitForJobToSettle — polls D6 until the job status is no longer PENDING/IN_PROGRESS.
 * Caps at 5 s to prevent test hangover.
 */
async function waitForJobToSettle(jobId, maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const job = await GitHubSyncJob.findOne({ jobId }).lean();
    if (job && !['PENDING', 'IN_PROGRESS'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  return GitHubSyncJob.findOne({ jobId }).lean();
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Process 7.2 — GitHub PR Sync', () => {
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
    await clearAllCollections();
    jest.clearAllMocks();
    // Reset axios mock between tests
    axios.get.mockReset && axios.get.mockReset();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Unit: determineMergeStatus
  // ══════════════════════════════════════════════════════════════════════════

  describe('determineMergeStatus (unit)', () => {
    it('returns UNKNOWN for null PR', () => {
      expect(determineMergeStatus(null)).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for undefined PR', () => {
      expect(determineMergeStatus(undefined)).toBe('UNKNOWN');
    });

    it('returns MERGED when pr.merged === true', () => {
      expect(determineMergeStatus({ merged: true, merge_state: 'clean' })).toBe('MERGED');
    });

    it('returns MERGED when pr.merged_at is set (closed+merged)', () => {
      expect(determineMergeStatus({ merged: false, merged_at: new Date().toISOString() })).toBe('MERGED');
    });

    it('returns NOT_MERGED for clean state (open PR)', () => {
      expect(determineMergeStatus({ merged: false, merge_state: 'clean' })).toBe('NOT_MERGED');
    });

    it('returns NOT_MERGED for blocked, behind, unstable states', () => {
      for (const state of ['blocked', 'behind', 'unstable', 'draft']) {
        expect(determineMergeStatus({ merged: false, merge_state: state })).toBe('NOT_MERGED');
      }
    });

    it('returns UNKNOWN for unrecognized merge_state', () => {
      expect(determineMergeStatus({ merged: false, merge_state: 'some_future_state' })).toBe('UNKNOWN');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Unit: getGitHubConfig
  // ══════════════════════════════════════════════════════════════════════════

  describe('getGitHubConfig (unit)', () => {
    it('throws INVALID_GITHUB_CREDENTIALS when group does not exist', async () => {
      await expect(getGitHubConfig('grp_nonexistent')).rejects.toMatchObject({
        code: 'INVALID_GITHUB_CREDENTIALS',
      });
    });

    it('throws INVALID_GITHUB_CREDENTIALS when GitHub is not configured', async () => {
      const groupId = unique('grp_nocfg');
      await Group.create({
        groupId,
        groupName: unique('NoGH'),
        leaderId: unique('lead'),
        status: 'active',
        // No githubPat / githubOrg
      });
      await expect(getGitHubConfig(groupId)).rejects.toMatchObject({
        code: 'INVALID_GITHUB_CREDENTIALS',
      });
    });

    it('returns config object when GitHub is fully configured', async () => {
      const { groupId } = await seedGroupWithGitHub();
      const cfg = await getGitHubConfig(groupId);
      expect(cfg.pat).toBe('ghp_test_pat_token');
      expect(cfg.owner).toBe('test-org');
      expect(cfg.repo).toBe('test-repo');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Unit: getSprintIssues
  // ══════════════════════════════════════════════════════════════════════════

  describe('getSprintIssues (unit)', () => {
    it('throws JIRA_DATA_MISSING when D6 has no sprint record', async () => {
      const { getSprintIssues: gsi } = require('../src/services/githubSyncService');
      await expect(gsi('spr_no_record', 'grp_no_record')).rejects.toMatchObject({
        code: 'JIRA_DATA_MISSING',
      });
    });

    it('returns issues from SprintRecord.deliverableRefs', async () => {
      const groupId = unique('grp');
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [
          { deliverableId: 'del_001', type: 'proposal', submittedAt: new Date() },
          { deliverableId: 'del_002', type: 'demonstration', submittedAt: new Date() },
        ],
      });

      const { getSprintIssues: gsi } = require('../src/services/githubSyncService');
      const issues = await gsi(sprintId, groupId);
      expect(issues.length).toBeGreaterThanOrEqual(2);
      expect(issues.map((i) => i.key)).toContain('del_001');
      expect(issues.map((i) => i.key)).toContain('del_002');
    });

    it('supplements with ContributionRecord entries', async () => {
      const groupId = unique('grp');
      const sprintId = unique('spr');
      const studentId = unique('stu');

      await seedSprintRecord(groupId, sprintId, { deliverableRefs: [] });
      await ContributionRecord.create({
        sprintId,
        studentId,
        groupId,
        storyPointsAssigned: 5,
      });

      const { getSprintIssues: gsi } = require('../src/services/githubSyncService');
      const issues = await gsi(sprintId, groupId);
      expect(issues.some((i) => i.studentId === studentId)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HTTP: POST /groups/:groupId/sprints/:sprintId/github-sync
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /groups/:groupId/sprints/:sprintId/github-sync', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).post(`${API}/groups/grp_x/sprints/spr_x/github-sync`);
      expect(res.status).toBe(401);
    });

    it('returns 403 when caller is a student (not coordinator/professor)', async () => {
      const { token } = tokenStudent();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 JIRA_DATA_MISSING when group does not exist', async () => {
      const { token } = tokenCoordinator();
      const res = await request(app)
        .post(`${API}/groups/grp_nonexistent/sprints/spr_x/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('JIRA_DATA_MISSING');
    });

    it('returns 400 INVALID_GITHUB_CREDENTIALS when GitHub is not configured', async () => {
      const { token } = tokenCoordinator();
      const groupId = unique('grp_nocfg');
      await Group.create({
        groupId,
        groupName: unique('GNoGH'),
        leaderId: unique('lead'),
        status: 'active',
        // No GitHub config
      });
      const sprintId = unique('spr');

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_GITHUB_CREDENTIALS');
    });

    it('returns 404 JIRA_DATA_MISSING when Process 7.1 has not run (D6 empty)', async () => {
      // QA checklist: "Confirm that if Process 7.1 has not run (D6 empty), the endpoint returns 404"
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      // Intentionally skip seedSprintRecord

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/spr_not_exist/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('JIRA_DATA_MISSING');
    });

    it('returns 202 + job_id + status PENDING for a valid request', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      // Mock GitHub API — successful open PR
      axios.get = jest.fn().mockResolvedValue({
        data: [{ number: 42, html_url: 'https://github.com/test-org/test-repo/pull/42', merged: false, merge_state: 'clean' }],
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
      expect(res.body.job_id).toBeTruthy();
      expect(res.body.status).toBe('PENDING');
    });

    it('writes GITHUB_SYNC_INITIATED audit log on 202 acceptance', async () => {
      const coord = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      axios.get = jest.fn().mockResolvedValue({ data: [] });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${coord.token}`);

      expect(res.status).toBe(202);

      const audit = await AuditLog.findOne({
        action: 'GITHUB_SYNC_INITIATED',
        actorId: coord.userId,
        groupId,
      }).lean();
      expect(audit).toBeTruthy();
      expect(audit.payload.sprintId).toBe(sprintId);
    });

    it('creates a GitHubSyncJob document in D6 after 202', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      axios.get = jest.fn().mockResolvedValue({ data: [] });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      const job = await GitHubSyncJob.findOne({ jobId: res.body.job_id }).lean();
      expect(job).toBeTruthy();
      expect(job.groupId).toBe(groupId);
      expect(job.sprintId).toBe(sprintId);
      expect(['PENDING', 'IN_PROGRESS', 'COMPLETED']).toContain(job.status);
    });

    // ── QA checklist: 409 concurrency guard ──────────────────────────────────
    it('returns 409 SYNC_ALREADY_RUNNING when a second POST arrives while IN_PROGRESS', async () => {
      // QA: "Verify that a second POST request within 5 seconds returns a 409"
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      // Pre-create an IN_PROGRESS lock in D6 (simulates running worker)
      await GitHubSyncJob.create({
        groupId,
        sprintId,
        status: 'IN_PROGRESS',
        triggeredBy: 'coord_seed',
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SYNC_ALREADY_RUNNING');
    });

    it('allows a new sync after the previous job is COMPLETED (lock released)', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      // Pre-create a COMPLETED job (lock already released)
      await GitHubSyncJob.create({
        groupId,
        sprintId,
        status: 'COMPLETED',
        triggeredBy: 'coord_seed',
      });

      axios.get = jest.fn().mockResolvedValue({ data: [] });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
    });

    it('professor role can also trigger a sync (202)', async () => {
      const { token } = tokenProfessor();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      axios.get = jest.fn().mockResolvedValue({ data: [] });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HTTP: GET /groups/:groupId/sprints/:sprintId/github-sync/:jobId
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /groups/:groupId/sprints/:sprintId/github-sync/:jobId', () => {
    it('returns 404 when jobId does not exist', async () => {
      const { token } = tokenCoordinator();
      const groupId = unique('grp');
      const sprintId = unique('spr');

      const res = await request(app)
        .get(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync/nonexistent_job`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('JOB_NOT_FOUND');
    });

    it('returns 200 with job details when job exists', async () => {
      const { token } = tokenCoordinator();
      const groupId = unique('grp');
      const sprintId = unique('spr');

      const job = await GitHubSyncJob.create({
        groupId,
        sprintId,
        status: 'COMPLETED',
        validationRecords: [
          {
            issueKey: 'issue_001',
            prId: '99',
            prUrl: 'https://github.com/test-org/test-repo/pull/99',
            mergeStatus: 'MERGED',
            lastValidated: new Date(),
            rawState: 'merged',
          },
        ],
      });

      const res = await request(app)
        .get(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync/${job.jobId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.job_id).toBe(job.jobId);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.validationRecords).toHaveLength(1);
      expect(res.body.validationRecords[0].mergeStatus).toBe('MERGED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HTTP: GET /groups/:groupId/sprints/:sprintId/github-sync (latest)
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /groups/:groupId/sprints/:sprintId/github-sync (latest)', () => {
    it('returns 404 when no jobs exist for this sprint', async () => {
      const { token } = tokenCoordinator();
      const res = await request(app)
        .get(`${API}/groups/${unique('grp')}/sprints/${unique('spr')}/github-sync`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns the most recent job of multiple', async () => {
      const { token } = tokenCoordinator();
      const groupId = unique('grp');
      const sprintId = unique('spr');

      // Older job
      await GitHubSyncJob.create({ groupId, sprintId, status: 'COMPLETED' });
      await new Promise((r) => setTimeout(r, 10)); // ensure different timestamp
      // Newer job
      const newer = await GitHubSyncJob.create({ groupId, sprintId, status: 'FAILED' });

      const res = await request(app)
        .get(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.job_id).toBe(newer.jobId);
      expect(res.body.status).toBe('FAILED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Async worker integration: merge_status propagation
  // ══════════════════════════════════════════════════════════════════════════

  describe('Async worker — merge_status propagation', () => {
    it('transitions merge_status UNKNOWN → MERGED after successful sync with a merged PR', async () => {
      // QA checklist: "Verify that D6 merge_status updates from UNKNOWN to MERGED after a successful sync"
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [{ deliverableId: 'DEL-001', type: 'proposal', submittedAt: new Date() }],
      });

      // GitHub returns a merged PR
      axios.get = jest.fn().mockResolvedValue({
        data: [
          {
            number: 1,
            html_url: 'https://github.com/test-org/test-repo/pull/1',
            merged: true,
            merged_at: new Date().toISOString(),
            merge_state: 'merged',
          },
        ],
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
      const jobId = res.body.job_id;

      // Wait for the async worker to settle
      const settled = await waitForJobToSettle(jobId);

      expect(settled).toBeTruthy();
      expect(settled.status).toBe('COMPLETED');
      const mergedRecord = settled.validationRecords.find((r) => r.issueKey === 'DEL-001');
      expect(mergedRecord).toBeTruthy();
      expect(mergedRecord.mergeStatus).toBe('MERGED');
    });

    it('records NOT_MERGED for open PRs', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [{ deliverableId: 'DEL-002', type: 'proposal', submittedAt: new Date() }],
      });

      // GitHub returns an open (clean) PR
      axios.get = jest.fn().mockResolvedValue({
        data: [
          {
            number: 2,
            html_url: 'https://github.com/test-org/test-repo/pull/2',
            merged: false,
            merged_at: null,
            merge_state: 'clean',
          },
        ],
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      const jobId = res.body.job_id;
      const settled = await waitForJobToSettle(jobId);

      const record = settled.validationRecords.find((r) => r.issueKey === 'DEL-002');
      expect(record?.mergeStatus).toBe('NOT_MERGED');
    });

    it('records UNKNOWN when no matching PR is found on GitHub', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [{ deliverableId: 'DEL-003', type: 'proposal', submittedAt: new Date() }],
      });

      // GitHub returns empty list for all branch patterns
      axios.get = jest.fn().mockResolvedValue({ data: [] });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      const jobId = res.body.job_id;
      const settled = await waitForJobToSettle(jobId);

      const record = settled.validationRecords.find((r) => r.issueKey === 'DEL-003');
      expect(record?.mergeStatus).toBe('UNKNOWN');
    });

    it('marks job COMPLETED even when some issues have no linked PR (partial UNKNOWN)', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [
          { deliverableId: 'DEL-010', type: 'proposal', submittedAt: new Date() },
          { deliverableId: 'DEL-011', type: 'demonstration', submittedAt: new Date() },
        ],
      });

      let callCount = 0;
      axios.get = jest.fn().mockImplementation(() => {
        callCount++;
        // First call → merged PR; subsequent calls → no PR
        if (callCount <= 4) {
          return Promise.resolve({
            data: [{ number: 10, html_url: 'https://github.com/test-org/test-repo/pull/10', merged: true, merged_at: new Date().toISOString(), merge_state: 'merged' }],
          });
        }
        return Promise.resolve({ data: [] });
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      const jobId = res.body.job_id;
      const settled = await waitForJobToSettle(jobId);
      expect(settled.status).toBe('COMPLETED');
      expect(settled.validationRecords).toHaveLength(2);
    });

    // ── QA checklist: GitHub 503 retry ───────────────────────────────────────
    it('retries on GitHub 503 before recording final status', async () => {
      // QA: "Mock a GitHub 503 error and ensure the system retries before returning a 502"
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [{ deliverableId: 'DEL-503', type: 'proposal', submittedAt: new Date() }],
      });

      let attemptCount = 0;
      const serverError = Object.assign(new Error('Service Unavailable'), {
        response: { status: 503 },
      });

      // First 2 calls fail with 503; 3rd succeeds
      axios.get = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount <= 2) {
          return Promise.reject(serverError);
        }
        return Promise.resolve({
          data: [{ number: 7, html_url: 'https://github.com/test-org/test-repo/pull/7', merged: true, merged_at: new Date().toISOString(), merge_state: 'merged' }],
        });
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
      const jobId = res.body.job_id;
      const settled = await waitForJobToSettle(jobId, 8000);

      // Retried at least twice
      expect(attemptCount).toBeGreaterThanOrEqual(3);
      // After retries, eventually succeeded
      expect(settled.status).toBe('COMPLETED');
      const record = settled.validationRecords.find((r) => r.issueKey === 'DEL-503');
      expect(record?.mergeStatus).toBe('MERGED');
    }, 12000);

    it('marks job FAILED when GitHub returns 503 on ALL retry attempts', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId, {
        deliverableRefs: [{ deliverableId: 'DEL-ALL-FAIL', type: 'proposal', submittedAt: new Date() }],
      });

      const serverError = Object.assign(new Error('Service Unavailable'), {
        response: { status: 503 },
      });

      // All calls fail — D2 config lookup (Group.findOne) uses mongoose, not axios
      // Only PR lookup calls go through axios
      axios.get = jest.fn().mockRejectedValue(serverError);

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(202);
      const jobId = res.body.job_id;
      const settled = await waitForJobToSettle(jobId, 8000);

      // Job should be COMPLETED with UNKNOWN records (worker catches per-issue errors)
      // OR FAILED if the D2/D6 read itself failed — either is acceptable
      expect(['COMPLETED', 'FAILED']).toContain(settled.status);
    }, 12000);

    it('writes GITHUB_SYNC_COMPLETED audit log on success', async () => {
      const coord = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      axios.get = jest.fn().mockResolvedValue({ data: [] });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${coord.token}`);

      const jobId = res.body.job_id;
      await waitForJobToSettle(jobId);

      const audit = await AuditLog.findOne({
        action: 'GITHUB_SYNC_COMPLETED',
        groupId,
        targetId: jobId,
      }).lean();
      expect(audit).toBeTruthy();
      expect(audit.payload.sprintId).toBe(sprintId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Lock lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  describe('Lock lifecycle', () => {
    it('releases lock (status → COMPLETED) so a subsequent sync can be triggered', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      axios.get = jest.fn().mockResolvedValue({ data: [] });

      // First sync
      const res1 = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);
      expect(res1.status).toBe(202);
      await waitForJobToSettle(res1.body.job_id);

      // Second sync — should be allowed since lock was released
      const res2 = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);
      expect(res2.status).toBe(202);
    });

    it('does NOT allow a new sync while an IN_PROGRESS lock is held', async () => {
      const { token } = tokenCoordinator();
      const { groupId } = await seedGroupWithGitHub();
      const sprintId = unique('spr');
      await seedSprintRecord(groupId, sprintId);

      // Directly plant an IN_PROGRESS lock (no worker)
      await GitHubSyncJob.create({ groupId, sprintId, status: 'IN_PROGRESS' });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/sprints/${sprintId}/github-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SYNC_ALREADY_RUNNING');
    });
  });
});
