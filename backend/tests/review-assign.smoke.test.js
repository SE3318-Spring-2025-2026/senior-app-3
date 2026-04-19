/**
 * Smoke tests — Process 6.1: POST /api/v1/reviews/assign
 *
 * Coverage:
 *   Auth guards
 *     401  no Authorization header
 *     401  malformed JWT
 *     403  student cannot assign review
 *     403  committee_member cannot assign review
 *     403  professor cannot assign review
 *
 *   Body validation
 *     400  missing deliverableId
 *     400  missing reviewDeadlineDays
 *     400  reviewDeadlineDays = 0 (below minimum)
 *     400  reviewDeadlineDays = 31 (above maximum)
 *     400  reviewDeadlineDays is not an integer (float)
 *
 *   Resource checks
 *     404  deliverable not found
 *     409  review already exists for this deliverable
 *     400  deliverable status is not 'accepted'
 *
 *   Member validation
 *     400  selectedCommitteeMembers contains invalid member IDs
 *
 *   Happy path (201)
 *     201  correct response shape: deliverableId, reviewId, assignedCommitteeMembers, assignedCount, deadline, notificationsSent, instructions
 *     201  assignedCommitteeMembers contains memberId, name, email, status: 'notified'
 *     201  deadline is approximately now + reviewDeadlineDays
 *     201  Review document created in DB with correct fields
 *     201  Deliverable status updated to 'under_review'
 *     201  selectedCommitteeMembers omitted → all committee members assigned automatically
 *     201  instructions persisted when provided; null when omitted
 *     201  AuditLog record created with action REVIEW_ASSIGNED
 *
 * Run:
 *   npm test -- review-assign.smoke.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'review-assign-smoke-test-secret';

jest.mock('../src/services/notificationService', () => ({
  dispatchReviewAssignmentNotification: jest.fn().mockResolvedValue({ success: true }),
  dispatchClarificationRequiredNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const Committee = require('../src/models/Committee');
const Deliverable = require('../src/models/Deliverable');
const Review = require('../src/models/Review');
const AuditLog = require('../src/models/AuditLog');

let mongod;
let app;

const ENDPOINT = '/api/v1/reviews/assign';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function token(userId, role) {
  return generateAccessToken(userId, role);
}

function coordToken() {
  const id = unique('coord');
  return { coordId: id, token: token(id, 'coordinator') };
}

/**
 * Seed a committee with N advisor Users and return { committee, memberIds, memberEmails }.
 */
async function seedCommittee(memberCount = 3, overrides = {}) {
  const memberIds = Array.from({ length: memberCount }, () => unique('prof'));
  const memberEmails = memberIds.map((id) => `${id}@uni.edu`);

  await User.insertMany(
    memberIds.map((userId, i) => ({
      userId,
      email: memberEmails[i],
      hashedPassword: '$2b$10$mock',
      role: 'professor',
      accountStatus: 'active',
      emailVerified: true,
    }))
  );

  const committeeId = unique('cmt');
  const committee = await Committee.create({
    committeeId,
    committeeName: `Committee-${committeeId}`,
    advisorIds: memberIds,
    juryIds: [],
    status: 'published',
    createdBy: unique('coord'),
    ...overrides,
  });

  return { committee, memberIds, memberEmails };
}

/**
 * Seed a Group and an 'accepted' Deliverable linked to a committee.
 */
async function seedDeliverable(committeeId, statusOverride = 'accepted') {
  const groupId = unique('grp');
  const leaderId = unique('stu');

  await Group.create({
    groupId,
    groupName: `Group-${groupId}`,
    leaderId,
    status: 'active',
    members: [{ userId: leaderId, role: 'leader', status: 'accepted' }],
  });

  const deliverableId = unique('del');
  await Deliverable.create({
    deliverableId,
    groupId,
    committeeId,
    submittedBy: leaderId,
    deliverableType: 'proposal',
    status: statusOverride,
    filePath: `uploads/${deliverableId}/doc.pdf`,
    fileSize: 102400,
    fileHash: `sha256_${deliverableId}`,
    format: 'pdf',
  });

  return { deliverableId, groupId };
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
  jest.clearAllMocks();
});

// ===========================================================================
// Auth guards
// ===========================================================================
describe('auth guards', () => {
  it('401 — no Authorization header', async () => {
    const res = await request(app).post(ENDPOINT).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed JWT', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer not.a.real.token')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('403 — student cannot assign review', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token(unique('stu'), 'student')}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 7 });
    expect(res.status).toBe(403);
  });

  it('403 — committee_member cannot assign review', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token(unique('cm'), 'committee_member')}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 7 });
    expect(res.status).toBe(403);
  });

  it('403 — professor cannot assign review', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token(unique('prof'), 'professor')}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 7 });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Body validation
// ===========================================================================
describe('body validation', () => {
  it('400 — missing deliverableId', async () => {
    const { token: t } = coordToken();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ reviewDeadlineDays: 7 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    expect(res.body.message).toMatch(/deliverableId/i);
  });

  it('400 — missing reviewDeadlineDays', async () => {
    const { token: t } = coordToken();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId: unique('del') });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    expect(res.body.message).toMatch(/reviewDeadlineDays/i);
  });

  it('400 — reviewDeadlineDays = 0 (minimum is 1)', async () => {
    const { token: t } = coordToken();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — reviewDeadlineDays = 31 (maximum is 30)', async () => {
    const { token: t } = coordToken();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 31 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — reviewDeadlineDays is a float (not an integer)', async () => {
    const { token: t } = coordToken();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 7.5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ===========================================================================
// Resource checks
// ===========================================================================
describe('resource checks', () => {
  it('404 — deliverable not found', async () => {
    const { token: t } = coordToken();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId: unique('del'), reviewDeadlineDays: 7 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DELIVERABLE_NOT_FOUND');
  });

  it('409 — review already exists for this deliverable', async () => {
    const { committee, memberIds } = await seedCommittee(2);
    const { deliverableId, groupId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    // First assignment succeeds
    await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: [memberIds[0]] });

    // Second assignment for the same deliverable
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: [memberIds[1]] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVIEW_ALREADY_EXISTS');
  });

  it('400 — deliverable status is not accepted (under_review)', async () => {
    const { committee, memberIds } = await seedCommittee(1);
    const { deliverableId } = await seedDeliverable(committee.committeeId, 'under_review');
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DELIVERABLE_STATUS');
    expect(res.body.message).toMatch(/accepted/i);
  });

  it('400 — deliverable status is awaiting_resubmission', async () => {
    const { committee, memberIds } = await seedCommittee(1);
    const { deliverableId } = await seedDeliverable(committee.committeeId, 'awaiting_resubmission');
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DELIVERABLE_STATUS');
  });
});

// ===========================================================================
// Member validation
// ===========================================================================
describe('member validation', () => {
  it('400 — selectedCommitteeMembers contains IDs not in committee', async () => {
    const { committee, memberIds } = await seedCommittee(2);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    const bogusId = unique('bogus');
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({
        deliverableId,
        reviewDeadlineDays: 7,
        selectedCommitteeMembers: [...memberIds, bogusId],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_MEMBER_IDS');
    expect(res.body.invalidMemberIds).toContain(bogusId);
    expect(res.body.invalidMemberIds).not.toContain(memberIds[0]);
  });

  it('400 — all selected member IDs are invalid', async () => {
    const { committee } = await seedCommittee(1);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({
        deliverableId,
        reviewDeadlineDays: 7,
        selectedCommitteeMembers: [unique('bogus'), unique('bogus')],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_MEMBER_IDS');
    expect(res.body.invalidMemberIds).toHaveLength(2);
  });
});

// ===========================================================================
// Happy path
// ===========================================================================
describe('happy path — 201', () => {
  it('returns correct top-level response shape', async () => {
    const { committee, memberIds } = await seedCommittee(3);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();
    const selected = memberIds.slice(0, 2);

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({
        deliverableId,
        reviewDeadlineDays: 7,
        selectedCommitteeMembers: selected,
        instructions: 'Focus on architecture section.',
      });

    expect(res.status).toBe(201);
    expect(res.body.deliverableId).toBe(deliverableId);
    expect(res.body.reviewId).toMatch(/^rev_/);
    expect(Array.isArray(res.body.assignedCommitteeMembers)).toBe(true);
    expect(res.body.assignedCount).toBe(selected.length);
    expect(typeof res.body.deadline).toBe('string');
    expect(new Date(res.body.deadline).toString()).not.toBe('Invalid Date');
    expect(res.body.notificationsSent).toBe(selected.length);
    expect(res.body.instructions).toBe('Focus on architecture section.');
  });

  it('assignedCommitteeMembers has memberId, name, email, status for each member', async () => {
    const { committee, memberIds, memberEmails } = await seedCommittee(2);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 5, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(201);
    const members = res.body.assignedCommitteeMembers;
    expect(members).toHaveLength(2);

    members.forEach((m) => {
      expect(m.memberId).toBeDefined();
      expect(memberIds).toContain(m.memberId);
      expect(m.status).toBe('notified');
      expect(m.email).toBe(memberEmails[memberIds.indexOf(m.memberId)]);
      expect(m.name).toBeDefined();
    });
  });

  it('deadline is approximately now + reviewDeadlineDays', async () => {
    const { committee, memberIds } = await seedCommittee(1);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();
    const days = 14;

    const before = Date.now();
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: days, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(201);

    const deadline = new Date(res.body.deadline).getTime();
    const expectedMin = before + (days - 1) * 86400000;
    const expectedMax = Date.now() + (days + 1) * 86400000;
    expect(deadline).toBeGreaterThanOrEqual(expectedMin);
    expect(deadline).toBeLessThanOrEqual(expectedMax);
  });

  it('Review document persisted in DB with correct fields', async () => {
    const { committee, memberIds } = await seedCommittee(2);
    const { deliverableId, groupId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();
    const selected = memberIds.slice(0, 1);

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: selected, instructions: 'Check methodology.' });

    expect(res.status).toBe(201);

    const review = await Review.findOne({ reviewId: res.body.reviewId }).lean();
    expect(review).not.toBeNull();
    expect(review.deliverableId).toBe(deliverableId);
    expect(review.groupId).toBe(groupId);
    expect(review.status).toBe('pending');
    expect(review.assignedMembers).toHaveLength(1);
    expect(review.assignedMembers[0].memberId).toBe(selected[0]);
    expect(review.assignedMembers[0].status).toBe('notified');
    expect(review.instructions).toBe('Check methodology.');
    expect(review.deadline).toBeInstanceOf(Date);
  });

  it('Deliverable status updated to under_review', async () => {
    const { committee, memberIds } = await seedCommittee(1);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(201);

    // Allow fire-and-forget update to settle
    await new Promise((r) => setTimeout(r, 100));

    const deliverable = await Deliverable.findOne({ deliverableId }).lean();
    expect(deliverable.status).toBe('under_review');
  });

  it('omitting selectedCommitteeMembers assigns all committee advisors automatically', async () => {
    const { committee, memberIds } = await seedCommittee(4);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7 });

    expect(res.status).toBe(201);
    expect(res.body.assignedCount).toBe(memberIds.length);
    expect(res.body.assignedCommitteeMembers.map((m) => m.memberId)).toEqual(
      expect.arrayContaining(memberIds)
    );
  });

  it('instructions is null in response and DB when not provided', async () => {
    const { committee, memberIds } = await seedCommittee(1);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 3, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(201);
    expect(res.body.instructions).toBeNull();

    const review = await Review.findOne({ reviewId: res.body.reviewId }).lean();
    expect(review.instructions).toBeNull();
  });

  it('AuditLog record created with REVIEW_ASSIGNED action', async () => {
    const { committee, memberIds } = await seedCommittee(2);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { coordId, token: t } = coordToken();

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: memberIds });

    expect(res.status).toBe(201);

    // Allow fire-and-forget audit log to write
    await new Promise((r) => setTimeout(r, 100));

    const audit = await AuditLog.findOne({
      action: 'REVIEW_ASSIGNED',
      actorId: coordId,
      'payload.reviewId': res.body.reviewId,
    }).lean();

    expect(audit).not.toBeNull();
    expect(audit.payload.deliverableId).toBe(deliverableId);
    expect(audit.payload.assignedMemberCount).toBe(memberIds.length);
  });

  it('notificationsSent equals the number of assigned members', async () => {
    const { committee, memberIds } = await seedCommittee(3);
    const { deliverableId } = await seedDeliverable(committee.committeeId);
    const { token: t } = coordToken();
    const selected = memberIds.slice(0, 2);

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${t}`)
      .send({ deliverableId, reviewDeadlineDays: 7, selectedCommitteeMembers: selected });

    expect(res.status).toBe(201);
    expect(res.body.notificationsSent).toBe(selected.length);
  });
});
