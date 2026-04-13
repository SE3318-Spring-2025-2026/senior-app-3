/**
 * Smoke tests — POST /api/deliverables/submit  (Process 5.2)
 *
 * Covers:
 *   401  no Authorization header
 *   401  invalid JWT
 *   403  non-student role
 *   400  missing required body fields
 *   400  invalid deliverableType enum value
 *   403  missing Authorization-Validation header
 *   403  expired / invalid validation token
 *   403  groupId mismatch between body and validation token
 *   429  rate limit exceeded (> 3 submissions in 10 min for same group)
 *   202  happy path — returns stagingId, fileHash, sizeMb, mimeType, nextStep
 *   202  description field is optional
 *
 * Run:
 *   npm test -- submit-deliverable.smoke.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'submit-deliverable-smoke-secret';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const DeliverableStaging = require('../src/models/DeliverableStaging');

const ENDPOINT = '/api/v1/deliverables/submit';
const JWT_SECRET = process.env.JWT_SECRET;

let mongod;
let app;

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function makeToken(userId, role) {
  return generateAccessToken(userId, role);
}

function makeValidationToken(groupId, committeeId = 'cmt_test', expiresIn = '15m') {
  return jwt.sign({ groupId, committeeId }, JWT_SECRET, { expiresIn });
}

/** Write a small temp PDF and return its path. */
function makePdf(name = 'test.pdf') {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, Buffer.from('%PDF-1.4 smoke test content'));
  return p;
}

/** Seed an active group with one student and return { groupId, studentId, token }. */
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
  const stagingDir = path.join(__dirname, '..', 'uploads', 'staging');
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
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
    const res = await request(app).post(ENDPOINT);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed token', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// Role guard
// ---------------------------------------------------------------------------
describe('role guard', () => {
  it('403 — coordinator cannot submit', async () => {
    const token = makeToken(unique('coord'), 'coordinator');
    const pdfPath = makePdf('coord.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Missing file
// ---------------------------------------------------------------------------
describe('missing file', () => {
  it('400 — no file attached', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FILE');
  });
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------
describe('body validation', () => {
  it('400 — missing groupId', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const pdfPath = makePdf('missing-group.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — missing sprintId', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const pdfPath = makePdf('missing-sprint.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — invalid deliverableType', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const pdfPath = makePdf('bad-type.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'unknown_type')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DELIVERABLE_TYPE');
  });
});

// ---------------------------------------------------------------------------
// Authorization-Validation header checks
// ---------------------------------------------------------------------------
describe('Authorization-Validation header', () => {
  it('403 — missing header', async () => {
    const { groupId, token } = await seedGroup();
    const pdfPath = makePdf('no-val.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MISSING_VALIDATION_TOKEN');
  });

  it('403 — expired validation token', async () => {
    const { groupId, token } = await seedGroup();
    const expiredToken = makeValidationToken(groupId, 'cmt_1', '-1s');
    const pdfPath = makePdf('expired-val.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', expiredToken)
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_VALIDATION_TOKEN');
  });

  it('403 — malformed validation token', async () => {
    const { groupId, token } = await seedGroup();
    const pdfPath = makePdf('bad-val.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', 'not.a.jwt')
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_VALIDATION_TOKEN');
  });

  it('403 — groupId in body does not match token groupId', async () => {
    const { token } = await seedGroup();
    const otherGroupId = unique('other');
    const validationToken = makeValidationToken(otherGroupId);
    const pdfPath = makePdf('mismatch.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', unique('yet_another'))
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GROUP_ID_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
describe('rate limiting', () => {
  it('429 — more than 3 submissions in 10 minutes', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);

    // Seed 3 existing staging records in the last 10 minutes
    await DeliverableStaging.insertMany([
      {
        stagingId: `stg_aaa0000001`,
        groupId,
        deliverableType: 'proposal',
        sprintId: 'sprint_1',
        submittedBy: unique('stu'),
        tempFilePath: '/tmp/fake1',
        fileSize: 100,
        fileHash: 'abc',
        mimeType: 'application/pdf',
      },
      {
        stagingId: `stg_bbb0000002`,
        groupId,
        deliverableType: 'proposal',
        sprintId: 'sprint_1',
        submittedBy: unique('stu'),
        tempFilePath: '/tmp/fake2',
        fileSize: 100,
        fileHash: 'def',
        mimeType: 'application/pdf',
      },
      {
        stagingId: `stg_ccc0000003`,
        groupId,
        deliverableType: 'proposal',
        sprintId: 'sprint_1',
        submittedBy: unique('stu'),
        tempFilePath: '/tmp/fake3',
        fileSize: 100,
        fileHash: 'ghi',
        mimeType: 'application/pdf',
      },
    ]);

    const pdfPath = makePdf('rate-limit.pdf');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
describe('happy path', () => {
  it('202 — returns stagingId, fileHash, sizeMb, mimeType, nextStep', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const pdfPath = makePdf('happy.pdf');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'proposal')
      .field('sprintId', 'sprint_1')
      .attach('file', pdfPath, { contentType: 'application/pdf' });

    expect(res.status).toBe(202);
    expect(res.body.stagingId).toMatch(/^stg_[0-9a-f]{10}$/);
    expect(res.body.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof res.body.sizeMb).toBe('number');
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.nextStep).toBe('format_validation');
  });

  it('202 — staging record is persisted in DB with correct fields', async () => {
    const { groupId, studentId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const pdfPath = makePdf('db-check.pdf');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'interim_report')
      .field('sprintId', 'sprint_2')
      .field('description', 'Mid-term interim report')
      .attach('file', pdfPath, { contentType: 'application/pdf' });

    expect(res.status).toBe(202);

    const record = await DeliverableStaging.findOne({ stagingId: res.body.stagingId }).lean();
    expect(record).not.toBeNull();
    expect(record.groupId).toBe(groupId);
    expect(record.deliverableType).toBe('interim_report');
    expect(record.sprintId).toBe('sprint_2');
    expect(record.submittedBy).toBe(studentId);
    expect(record.description).toBe('Mid-term interim report');
    expect(record.fileHash).toBe(res.body.fileHash);
    expect(record.mimeType).toBe('application/pdf');
    expect(record.status).toBe('staging');
    expect(record.expiresAt).toBeDefined();
    // expiresAt should be ~1 hour from now
    const diffMs = new Date(record.expiresAt) - Date.now();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThan(61 * 60 * 1000);
  });

  it('202 — description is optional', async () => {
    const { groupId, token } = await seedGroup();
    const validationToken = makeValidationToken(groupId);
    const pdfPath = makePdf('no-desc.pdf');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .set('Authorization-Validation', validationToken)
      .field('groupId', groupId)
      .field('deliverableType', 'final_report')
      .field('sprintId', 'sprint_3')
      .attach('file', pdfPath, { contentType: 'application/pdf' });

    expect(res.status).toBe(202);
    const record = await DeliverableStaging.findOne({ stagingId: res.body.stagingId }).lean();
    expect(record.description).toBeNull();
  });

  it('202 — all deliverableType enum values are accepted', async () => {
    const types = ['proposal', 'statement_of_work', 'demo', 'interim_report', 'final_report'];

    for (const deliverableType of types) {
      const { groupId, token } = await seedGroup();
      const validationToken = makeValidationToken(groupId);
      const pdfPath = makePdf(`type-${deliverableType}.pdf`);

      const res = await request(app)
        .post(ENDPOINT)
        .set('Authorization', `Bearer ${token}`)
        .set('Authorization-Validation', validationToken)
        .field('groupId', groupId)
        .field('deliverableType', deliverableType)
        .field('sprintId', 'sprint_1')
        .attach('file', pdfPath, { contentType: 'application/pdf' });

      expect(res.status).toBe(202);
    }
  });
});
