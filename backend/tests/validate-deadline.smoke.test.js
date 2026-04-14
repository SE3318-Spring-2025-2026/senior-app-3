/**
 * Smoke tests — POST /api/deliverables/:stagingId/validate-deadline  (Process 5.4)
 *
 * Covers:
 *   401  no Authorization header
 *   401  malformed / invalid token
 *   403  non-student role
 *   400  missing sprintId in body
 *   404  staging record not found
 *   404  staging record not in format_validated status
 *   403  deadline exceeded  → DEADLINE_EXCEEDED
 *   400  team requirements not met (member with non-accepted status) → TEAM_REQUIREMENTS_NOT_MET
 *   200  happy path — all fields present, DB status updated to requirements_validated
 *   DB   on failure staging status is updated to deadline_failed
 *
 * Run:
 *   npm test -- validate-deadline.smoke.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'validate-deadline-smoke-secret';

const mongoose = require('mongoose');
const request  = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const Group             = require('../src/models/Group');
const DeliverableStaging = require('../src/models/DeliverableStaging');
const SprintConfig      = require('../src/models/SprintConfig');

const ENDPOINT = (stagingId) => `/api/v1/deliverables/${stagingId}/validate-deadline`;

let mongod;
let app;

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function makeToken(userId, role) {
  return generateAccessToken(userId, role);
}

/**
 * Seeds an active group with one accepted leader and returns
 * { groupId, studentId, token }.
 */
async function seedGroup(memberOverrides = {}) {
  const studentId = unique('stu');
  const groupId   = unique('grp');

  await Group.create({
    groupId,
    groupName: unique('Group'),
    leaderId: studentId,
    status: 'active',
    members: [{ userId: studentId, role: 'leader', status: 'accepted', ...memberOverrides }],
  });

  return { groupId, studentId, token: makeToken(studentId, 'student') };
}

/**
 * Seeds a DeliverableStaging record in format_validated status and returns stagingId.
 */
async function seedStaging(groupId, studentId, overrides = {}) {
  const stagingId = `stg_${unique('').slice(-10)}`;

  await DeliverableStaging.create({
    stagingId,
    groupId,
    deliverableType: 'proposal',
    sprintId: 'sprint_1',
    submittedBy: studentId,
    tempFilePath: '/tmp/fake.pdf',
    fileSize: 1024,
    fileHash: 'abc123',
    mimeType: 'application/pdf',
    status: 'format_validated',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  });

  return stagingId;
}

/**
 * Seeds a SprintConfig record and returns it.
 */
async function seedSprintConfig(overrides = {}) {
  return SprintConfig.create({
    sprintId: 'sprint_1',
    deliverableType: 'proposal',
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    ...overrides,
  });
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
// Auth guard
// ---------------------------------------------------------------------------
describe('auth guard', () => {
  it('401 — no Authorization header', async () => {
    const res = await request(app)
      .post(ENDPOINT('stg_any'))
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed token', async () => {
    const res = await request(app)
      .post(ENDPOINT('stg_any'))
      .set('Authorization', 'Bearer not.a.real.token')
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// Role guard
// ---------------------------------------------------------------------------
describe('role guard', () => {
  it('403 — coordinator cannot call validate-deadline', async () => {
    const token = makeToken(unique('coord'), 'coordinator');

    const res = await request(app)
      .post(ENDPOINT('stg_any'))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Request body validation
// ---------------------------------------------------------------------------
describe('request body validation', () => {
  it('400 — missing sprintId', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// Staging record lookup
// ---------------------------------------------------------------------------
describe('staging record lookup', () => {
  it('404 — staging record does not exist', async () => {
    const { token } = await seedGroup();

    const res = await request(app)
      .post(ENDPOINT('stg_nonexistent'))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STAGING_NOT_FOUND');
  });

  it('404 — staging record exists but status is staging (not format_validated)', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId, { status: 'staging' });

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STAGING_NOT_FOUND');
  });

  it('404 — staging record exists but status is validation_failed', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId, { status: 'validation_failed' });

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STAGING_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Deadline check
// ---------------------------------------------------------------------------
describe('deadline check', () => {
  it('403 — deadline exceeded returns DEADLINE_EXCEEDED', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);

    // Seed a past deadline
    await seedSprintConfig({ deadline: new Date(Date.now() - 1000) });

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEADLINE_EXCEEDED');
  });

  it('DB — staging status set to deadline_failed when deadline exceeded', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);

    await seedSprintConfig({ deadline: new Date(Date.now() - 1000) });

    await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    const record = await DeliverableStaging.findOne({ stagingId }).lean();
    expect(record.status).toBe('deadline_failed');
  });

  it('400 — no SprintConfig for sprint returns DEADLINE_NOT_CONFIGURED', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);
    // No SprintConfig seeded

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEADLINE_NOT_CONFIGURED');
  });
});

// ---------------------------------------------------------------------------
// Team requirements check
// ---------------------------------------------------------------------------
describe('team requirements check', () => {
  it('400 — member with pending status returns TEAM_REQUIREMENTS_NOT_MET', async () => {
    const studentId = unique('stu');
    const groupId   = unique('grp');
    const pendingId = unique('stu_pending');

    await Group.create({
      groupId,
      groupName: unique('Group'),
      leaderId: studentId,
      status: 'active',
      members: [
        { userId: studentId,  role: 'leader', status: 'accepted' },
        { userId: pendingId,  role: 'member', status: 'pending'  },
      ],
    });

    const token     = makeToken(studentId, 'student');
    const stagingId = await seedStaging(groupId, studentId);
    await seedSprintConfig();

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TEAM_REQUIREMENTS_NOT_MET');
    expect(res.body.missingMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: pendingId, status: 'pending' }),
      ])
    );
  });

  it('DB — staging status set to deadline_failed when team requirements not met', async () => {
    const studentId = unique('stu');
    const groupId   = unique('grp');

    await Group.create({
      groupId,
      groupName: unique('Group'),
      leaderId: studentId,
      status: 'active',
      members: [
        { userId: studentId, role: 'leader', status: 'accepted' },
        { userId: unique('stu2'), role: 'member', status: 'pending' },
      ],
    });

    const token     = makeToken(studentId, 'student');
    const stagingId = await seedStaging(groupId, studentId);
    await seedSprintConfig();

    await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    const record = await DeliverableStaging.findOne({ stagingId }).lean();
    expect(record.status).toBe('deadline_failed');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
describe('happy path', () => {
  it('200 — returns all required fields', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);
    await seedSprintConfig();

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(200);
    expect(res.body.stagingId).toBe(stagingId);
    expect(res.body.deadlineOk).toBe(true);
    expect(res.body.sprintDeadline).toBeDefined();
    expect(typeof res.body.timeRemainingMinutes).toBe('number');
    expect(res.body.timeRemainingMinutes).toBeGreaterThan(0);
    expect(typeof res.body.submissionVersion).toBe('number');
    expect(typeof res.body.priorSubmissions).toBe('number');
    expect(res.body.readyForStorage).toBe(true);
  });

  it('200 — submissionVersion is priorSubmissions + 1', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);
    await seedSprintConfig();

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(200);
    expect(res.body.submissionVersion).toBe(res.body.priorSubmissions + 1);
  });

  it('DB — staging status updated to requirements_validated on success', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);
    await seedSprintConfig();

    await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    const record = await DeliverableStaging.findOne({ stagingId }).lean();
    expect(record.status).toBe('requirements_validated');
  });

  it('200 — sprintDeadline is a valid ISO date string', async () => {
    const { token, groupId, studentId } = await seedGroup();
    const stagingId = await seedStaging(groupId, studentId);
    await seedSprintConfig();

    const res = await request(app)
      .post(ENDPOINT(stagingId))
      .set('Authorization', `Bearer ${token}`)
      .send({ sprintId: 'sprint_1' });

    expect(res.status).toBe(200);
    expect(() => new Date(res.body.sprintDeadline)).not.toThrow();
    expect(new Date(res.body.sprintDeadline).toISOString()).toBe(res.body.sprintDeadline);
  });
});
