/**
 * Smoke tests — Process 6.2 comment endpoints
 *
 * POST /api/v1/deliverables/:deliverableId/comments  (addComment)
 *   401  no Authorization header
 *   401  malformed JWT
 *   403  student cannot initiate a comment
 *   404  deliverable not found
 *   400  no active review (none exists)
 *   400  no active review (review completed)
 *   400  missing content field
 *   400  content too long (> 5000 chars)
 *   400  invalid commentType enum value
 *   400  invalid sectionNumber (non-integer)
 *   201  committee_member happy path — minimal body, defaults applied
 *   201  coordinator happy path — all fields, needsResponse: true
 *   201  review status transitions: pending → in_progress on first comment
 *   201  review status transitions: → needs_clarification when needsResponse: true
 *   201  sectionNumber and optional fields persisted correctly
 *
 * GET /api/v1/deliverables/:deliverableId/comments  (getComments)
 *   401  no Authorization header
 *   401  malformed JWT
 *   404  deliverable not found
 *   403  student requesting another group's deliverable
 *   200  happy path — returns correct response shape
 *   200  student can view their own group's comments
 *   200  coordinator can view any deliverable's comments
 *   200  status filter narrows results
 *   200  sortBy=section orders by sectionNumber
 *   200  page param skips correct records
 *   200  openClarificationCount reflects open clarification_required comments with needsResponse
 *
 * Run:
 *   npm test -- comments.smoke.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'comments-smoke-test-secret';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const Deliverable = require('../src/models/Deliverable');
const Review = require('../src/models/Review');
const Comment = require('../src/models/Comment');

let mongod;
let app;

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function makeToken(userId, role) {
  return generateAccessToken(userId, role);
}

const POST = (deliverableId) => `/api/v1/deliverables/${deliverableId}/comments`;
const GET  = (deliverableId) => `/api/v1/deliverables/${deliverableId}/comments`;

/**
 * Seed an active group with one student and return { groupId, studentId, studentToken }.
 */
async function seedGroup(overrides = {}) {
  const studentId = unique('stu');
  const groupId   = unique('grp');
  await Group.create({
    groupId,
    groupName: unique('Group'),
    leaderId: studentId,
    status: 'active',
    members: [{ userId: studentId, role: 'leader', status: 'accepted' }],
    ...overrides,
  });
  return { groupId, studentId, studentToken: makeToken(studentId, 'student') };
}

/**
 * Seed a Deliverable and a pending Review for it. Returns { deliverableId, reviewId }.
 */
async function seedDeliverableWithReview(groupId, reviewStatus = 'pending') {
  const deliverableId = unique('del');
  const reviewId      = unique('rev');

  await Deliverable.create({
    deliverableId,
    committeeId: unique('cmt'),
    groupId,
    studentId: unique('stu'),
    type: 'proposal',
    submittedAt: new Date(),
    storageRef: '/uploads/test.pdf',
    status: 'submitted',
  });

  await Review.create({
    reviewId,
    deliverableId,
    groupId,
    status: reviewStatus,
    assignedMembers: [],
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return { deliverableId, reviewId };
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

// ===========================================================================
// POST /:deliverableId/comments
// ===========================================================================

describe('POST /api/v1/deliverables/:deliverableId/comments', () => {

  // -------------------------------------------------------------------------
  // Auth guard
  // -------------------------------------------------------------------------
  describe('auth guard', () => {
    it('401 — no Authorization header', async () => {
      const res = await request(app).post(POST('del-x')).send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('401 — malformed JWT', async () => {
      const res = await request(app)
        .post(POST('del-x'))
        .set('Authorization', 'Bearer not.a.real.token')
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // Role guard
  // -------------------------------------------------------------------------
  describe('role guard', () => {
    it('403 — student cannot initiate a comment', async () => {
      const { studentId } = await seedGroup();
      const token = makeToken(studentId, 'student');
      const res = await request(app)
        .post(POST('del-x'))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'test' });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Deliverable / review existence checks
  // -------------------------------------------------------------------------
  describe('resource checks', () => {
    it('404 — deliverable not found', async () => {
      const token = makeToken(unique('cm'), 'committee_member');
      const res = await request(app)
        .post(POST('del_nonexistent'))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'This section needs clarification.' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('DELIVERABLE_NOT_FOUND');
    });

    it('400 — deliverable exists but has no review', async () => {
      const { groupId } = await seedGroup();
      const deliverableId = unique('del');
      await Deliverable.create({
        deliverableId,
        committeeId: unique('cmt'),
        groupId,
        studentId: unique('stu'),
        type: 'proposal',
        submittedAt: new Date(),
        storageRef: '/uploads/test.pdf',
        status: 'submitted',
      });

      const token = makeToken(unique('cm'), 'committee_member');
      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'This section needs clarification.' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NO_ACTIVE_REVIEW');
    });

    it('400 — review exists but is already completed', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId, 'completed');

      const token = makeToken(unique('cm'), 'committee_member');
      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Late comment attempt.' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NO_ACTIVE_REVIEW');
    });
  });

  // -------------------------------------------------------------------------
  // Body validation
  // -------------------------------------------------------------------------
  describe('body validation', () => {
    it('400 — missing content field', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    });

    it('400 — content exceeds 5000 characters', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'x'.repeat(5001) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    });

    it('400 — invalid commentType enum value', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Valid content.', commentType: 'not_a_real_type' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_COMMENT_TYPE');
    });

    it('400 — sectionNumber is not a positive integer', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Valid content.', sectionNumber: -3 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  describe('happy path', () => {
    it('201 — committee_member creates a minimal comment; defaults applied', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'This section needs clarification.' });

      expect(res.status).toBe(201);
      expect(res.body.commentId).toMatch(/^cmt_/);
      expect(res.body.deliverableId).toBe(deliverableId);
      expect(res.body.content).toBe('This section needs clarification.');
      expect(res.body.commentType).toBe('general');
      expect(res.body.sectionNumber).toBeNull();
      expect(res.body.needsResponse).toBe(false);
      expect(res.body.status).toBe('open');
      expect(res.body.replies).toEqual([]);
      expect(res.body.createdAt).toBeDefined();
    });

    it('201 — coordinator creates comment with all fields populated', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('coord'), 'coordinator');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'Please clarify the scope in section 3.',
          commentType: 'clarification_required',
          sectionNumber: 3,
          needsResponse: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.commentType).toBe('clarification_required');
      expect(res.body.sectionNumber).toBe(3);
      expect(res.body.needsResponse).toBe(true);
    });

    it('201 — comment is persisted in DB with correct fields', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const cmId = unique('cm');
      const token = makeToken(cmId, 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Please elaborate.', commentType: 'question', sectionNumber: 2 });

      expect(res.status).toBe(201);

      const saved = await Comment.findOne({ commentId: res.body.commentId }).lean();
      expect(saved).not.toBeNull();
      expect(saved.deliverableId).toBe(deliverableId);
      expect(saved.authorId).toBe(cmId);
      expect(saved.content).toBe('Please elaborate.');
      expect(saved.commentType).toBe('question');
      expect(saved.sectionNumber).toBe(2);
      expect(saved.status).toBe('open');
    });

    it('201 — review status transitions from pending to in_progress', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId, reviewId } = await seedDeliverableWithReview(groupId, 'pending');
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'General observation.', needsResponse: false });

      expect(res.status).toBe(201);

      // Give the fire-and-forget update a moment to complete
      await new Promise((r) => setTimeout(r, 100));

      const review = await Review.findOne({ reviewId }).lean();
      expect(review.status).toBe('in_progress');
    });

    it('201 — review status transitions to needs_clarification when needsResponse: true', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId, reviewId } = await seedDeliverableWithReview(groupId, 'pending');
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Please clarify.', needsResponse: true });

      expect(res.status).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const review = await Review.findOne({ reviewId }).lean();
      expect(review.status).toBe('needs_clarification');
    });

    it('201 — review already in_progress stays in_progress when needsResponse: false', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId, reviewId } = await seedDeliverableWithReview(groupId, 'in_progress');
      const token = makeToken(unique('cm'), 'committee_member');

      const res = await request(app)
        .post(POST(deliverableId))
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Follow-up comment.', needsResponse: false });

      expect(res.status).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const review = await Review.findOne({ reviewId }).lean();
      expect(review.status).toBe('in_progress');
    });
  });
});

// ===========================================================================
// GET /:deliverableId/comments
// ===========================================================================

describe('GET /api/v1/deliverables/:deliverableId/comments', () => {

  // -------------------------------------------------------------------------
  // Auth guard
  // -------------------------------------------------------------------------
  describe('auth guard', () => {
    it('401 — no Authorization header', async () => {
      const res = await request(app).get(GET('del-x'));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('401 — malformed JWT', async () => {
      const res = await request(app)
        .get(GET('del-x'))
        .set('Authorization', 'Bearer not.a.real.token');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // Resource check
  // -------------------------------------------------------------------------
  describe('resource check', () => {
    it('404 — deliverable not found', async () => {
      const token = makeToken(unique('coord'), 'coordinator');
      const res = await request(app)
        .get(GET('del_nonexistent'))
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('DELIVERABLE_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------
  describe('access control', () => {
    it('403 — student cannot view another group\'s comments', async () => {
      const { groupId: ownerGroupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(ownerGroupId);

      // A different student in a different group
      const { studentId: otherId } = await seedGroup();
      const token = makeToken(otherId, 'student');

      const res = await request(app)
        .get(GET(deliverableId))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('200 — student can view their own group\'s comments', async () => {
      const { groupId, studentId, studentToken } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);

      const res = await request(app)
        .get(GET(deliverableId))
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.deliverableId).toBe(deliverableId);
    });

    it('200 — coordinator can view any deliverable\'s comments', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('coord'), 'coordinator');

      const res = await request(app)
        .get(GET(deliverableId))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — response shape
  // -------------------------------------------------------------------------
  describe('response shape', () => {
    it('200 — returns correct top-level fields with empty thread', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const token = makeToken(unique('coord'), 'coordinator');

      const res = await request(app)
        .get(GET(deliverableId))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.deliverableId).toBe(deliverableId);
      expect(Array.isArray(res.body.comments)).toBe(true);
      expect(res.body.comments).toHaveLength(0);
      expect(res.body.totalCount).toBe(0);
      expect(res.body.openClarificationCount).toBe(0);
    });

    it('200 — returns seeded comments with expected fields per comment', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);

      await Comment.create({
        deliverableId,
        authorId: unique('cm'),
        authorName: 'reviewer@test.com',
        content: 'Please clarify section 2.',
        commentType: 'clarification_required',
        sectionNumber: 2,
        needsResponse: true,
        status: 'open',
      });

      const token = makeToken(unique('coord'), 'coordinator');
      const res = await request(app)
        .get(GET(deliverableId))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(1);
      expect(res.body.openClarificationCount).toBe(1);

      const comment = res.body.comments[0];
      expect(comment.commentId).toMatch(/^cmt_/);
      expect(comment.content).toBe('Please clarify section 2.');
      expect(comment.commentType).toBe('clarification_required');
      expect(comment.sectionNumber).toBe(2);
      expect(comment.needsResponse).toBe(true);
      expect(comment.status).toBe('open');
      expect(Array.isArray(comment.replies)).toBe(true);
      expect(comment.createdAt).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Filtering & sorting
  // -------------------------------------------------------------------------
  describe('filtering and sorting', () => {
    it('200 — status=resolved filter returns only resolved comments', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const authorId = unique('cm');

      await Comment.create([
        { deliverableId, authorId, authorName: 'a@test.com', content: 'Open comment.', status: 'open' },
        { deliverableId, authorId, authorName: 'a@test.com', content: 'Resolved comment.', status: 'resolved' },
        { deliverableId, authorId, authorName: 'a@test.com', content: 'Another resolved.', status: 'resolved' },
      ]);

      const token = makeToken(unique('coord'), 'coordinator');
      const res = await request(app)
        .get(`${GET(deliverableId)}?status=resolved`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(2);
      expect(res.body.totalCount).toBe(2);
      res.body.comments.forEach((c) => expect(c.status).toBe('resolved'));
    });

    it('200 — sortBy=section orders by sectionNumber ascending', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const authorId = unique('cm');

      await Comment.create([
        { deliverableId, authorId, authorName: 'a@test.com', content: 'Section 5.', sectionNumber: 5 },
        { deliverableId, authorId, authorName: 'a@test.com', content: 'Section 1.', sectionNumber: 1 },
        { deliverableId, authorId, authorName: 'a@test.com', content: 'Section 3.', sectionNumber: 3 },
      ]);

      const token = makeToken(unique('coord'), 'coordinator');
      const res = await request(app)
        .get(`${GET(deliverableId)}?sortBy=section`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const sections = res.body.comments.map((c) => c.sectionNumber);
      expect(sections).toEqual([1, 3, 5]);
    });

    it('200 — page=2 returns next page of results', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const authorId = unique('cm');

      // Seed 22 comments to overflow past page 1 (limit 20)
      const docs = Array.from({ length: 22 }, (_, i) => ({
        deliverableId,
        authorId,
        authorName: 'a@test.com',
        content: `Comment ${String(i).padStart(3, '0')}`,
      }));
      await Comment.insertMany(docs);

      const token = makeToken(unique('coord'), 'coordinator');
      const res = await request(app)
        .get(`${GET(deliverableId)}?page=2`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(22);
      expect(res.body.comments).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // openClarificationCount accuracy
  // -------------------------------------------------------------------------
  describe('openClarificationCount', () => {
    it('200 — counts only open clarification_required comments with needsResponse: true', async () => {
      const { groupId } = await seedGroup();
      const { deliverableId } = await seedDeliverableWithReview(groupId);
      const authorId = unique('cm');

      await Comment.create([
        // Should count
        { deliverableId, authorId, authorName: 'a@t.com', content: 'c1', commentType: 'clarification_required', needsResponse: true,  status: 'open'     },
        { deliverableId, authorId, authorName: 'a@t.com', content: 'c2', commentType: 'clarification_required', needsResponse: true,  status: 'open'     },
        // Should NOT count — resolved
        { deliverableId, authorId, authorName: 'a@t.com', content: 'c3', commentType: 'clarification_required', needsResponse: true,  status: 'resolved' },
        // Should NOT count — needsResponse: false
        { deliverableId, authorId, authorName: 'a@t.com', content: 'c4', commentType: 'clarification_required', needsResponse: false, status: 'open'     },
        // Should NOT count — different commentType
        { deliverableId, authorId, authorName: 'a@t.com', content: 'c5', commentType: 'general',                needsResponse: true,  status: 'open'     },
      ]);

      const token = makeToken(unique('coord'), 'coordinator');
      const res = await request(app)
        .get(GET(deliverableId))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(5);
      expect(res.body.openClarificationCount).toBe(2);
    });
  });
});
