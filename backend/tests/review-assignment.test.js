'use strict';

/**
 * Review Assignment Tests
 * Comprehensive tests for the POST /reviews/assign endpoint
 *
 * Coverage:
 * - Valid assignment with all fields → 201, Review created, Deliverable updated to under_review
 * - selectedCommitteeMembers omitted → all D3 members assigned
 * - Non-coordinator calls → 403
 * - Deliverable not found → 404
 * - Deliverable not in 'accepted' status → 400
 * - Review already exists for this deliverable → 409
 * - Invalid member IDs → 400 with list of bad IDs
 * - reviewDeadlineDays missing → 400
 *
 * Run: npm test -- review-assignment.test.js
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'review-assignment-test-secret';

jest.mock('../src/services/notificationService', () => ({
  dispatchReviewAssignmentNotification: jest.fn().mockResolvedValue({
    success: true,
    notificationId: 'notif_mock_review_assign',
  }),
  dispatchClarificationRequiredNotification: jest.fn().mockResolvedValue({
    success: true,
  }),
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

const {
  generateUniqueId,
  createCoordinator,
  createCommitteeMember,
  createGroup,
  createCommittee,
  createDeliverable,
  setupReviewScenario,
} = require('./fixtures/review-test-data');

let mongod;
let app;

const API = '/api/v1';

/**
 * Helper: Clear all collections
 */
async function clearAllCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/**
 * Helper: Generate coordinator JWT token
 */
function tokenCoordinator(userId = generateUniqueId('coord')) {
  return { userId, token: generateAccessToken(userId, 'coordinator') };
}

/**
 * Helper: Generate student JWT token
 */
function tokenStudent(userId = generateUniqueId('stu')) {
  return { userId, token: generateAccessToken(userId, 'student') };
}

/**
 * Helper: Generate professor JWT token
 */
function tokenProfessor(userId = generateUniqueId('prof')) {
  return { userId, token: generateAccessToken(userId, 'professor') };
}

describe('POST /api/v1/reviews/assign', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = require('../src/index');
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  afterEach(async () => {
    await clearAllCollections();
    jest.clearAllMocks();
  });

  describe('Authorization and validation', () => {
    it('should return 401 when no authorization header provided', async () => {
      const res = await request(app).post(`${API}/reviews/assign`).send({
        deliverableId: generateUniqueId('del'),
        reviewDeadlineDays: 7,
      });

      expect(res.status).toBe(401);
    });

    it('should return 403 when student role tries to assign review', async () => {
      const { token } = tokenStudent();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers.map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(403);
    });

    it('should return 403 when professor role tries to assign review', async () => {
      const { token } = tokenProfessor();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers.map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Deliverable validation', () => {
    it('should return 404 when deliverable not found', async () => {
      const { userId, token } = tokenCoordinator();
      const nonExistentId = generateUniqueId('del');

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: nonExistentId,
          selectedCommitteeMembers: [generateUniqueId('prof')],
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Deliverable not found');
    });

    it('should return 400 when deliverable status is not accepted', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario({
        deliverableStatus: 'under_review',
      });
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers.map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('accepted');
    });

    it('should return 400 when deliverable status is rejected', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario({
        deliverableStatus: 'awaiting_resubmission',
      });
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers.map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Field validation', () => {
    it('should return 400 when reviewDeadlineDays is missing', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers.map((m) => m.userId),
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('reviewDeadlineDays');
    });

    it('should return 400 when reviewDeadlineDays is zero or negative', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers.map((m) => m.userId),
          reviewDeadlineDays: 0,
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 with invalid member IDs in response', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);
      
      const validIds = scenario.committeeMembers.slice(0, 2).map((m) => m.userId);
      const invalidIds = [generateUniqueId('invalid'), generateUniqueId('invalid')];

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: [...validIds, ...invalidIds],
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('invalidMemberIds');
      expect(res.body.invalidMemberIds).toContain(invalidIds[0]);
    });
  });

  describe('Review creation', () => {
    it('should create review with 201 and update deliverable to under_review', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);

      const selectedMembers = scenario.committeeMembers.slice(0, 2).map((m) => m.userId);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: selectedMembers,
          reviewDeadlineDays: 7,
          instructions: 'Please review the proposal carefully.',
        });

      expect(res.status).toBe(201);
      expect(res.body.reviewId).toBeTruthy();
      expect(res.body.deliverableId).toBe(scenario.deliverable.deliverableId);
      expect(res.body.assignedCommitteeMembers).toHaveLength(selectedMembers.length);
      expect(res.body.assignedCount).toBe(selectedMembers.length);
      expect(res.body.assignedCommitteeMembers.every((m) => m.status === 'notified')).toBe(true);
      expect(res.body.assignedCommitteeMembers.every((m) => m.memberId)).toBe(true);
      expect(res.body.deadline).toBeDefined();
      expect(res.body.notificationsSent).toBe(selectedMembers.length);

      // Verify Review was created
      const review = await Review.findOne({
        reviewId: res.body.reviewId,
      }).lean();
      expect(review).toBeTruthy();
      expect(review.deliverableId).toBe(scenario.deliverable.deliverableId);
      expect(review.groupId).toBe(scenario.group.groupId);
      expect(review.assignedMembers).toHaveLength(selectedMembers.length);

      // Give fire-and-forget deliverable update a moment to complete
      await new Promise((r) => setTimeout(r, 100));

      // Verify Deliverable was updated to under_review
      const deliverable = await Deliverable.findOne({
        deliverableId: scenario.deliverable.deliverableId,
      }).lean();
      expect(deliverable.status).toBe('under_review');
    });

    it('should include all committee members when selectedCommitteeMembers omitted', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario({ memberCount: 4 });
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(201);
      expect(res.body.assignedCommitteeMembers).toHaveLength(
        scenario.committee.advisorIds.length
      );
      expect(res.body.assignedCount).toBe(scenario.committee.advisorIds.length);
      expect(res.body.assignedCommitteeMembers.map((m) => m.memberId)).toEqual(
        expect.arrayContaining(scenario.committee.advisorIds)
      );

      // Verify in DB
      const review = await Review.findOne({
        reviewId: res.body.reviewId,
      }).lean();
      expect(review.assignedMembers).toHaveLength(
        scenario.committee.advisorIds.length
      );
    });

    it('should set correct deadline based on reviewDeadlineDays', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);
      
      const deadlineDays = 14;
      const beforeTime = Date.now();

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers
            .slice(0, 1)
            .map((m) => m.userId),
          reviewDeadlineDays: deadlineDays,
        });

      expect(res.status).toBe(201);
      const deadline = new Date(res.body.deadline);
      const expectedMinDate = new Date();
      expectedMinDate.setDate(expectedMinDate.getDate() + deadlineDays - 1);
      const expectedMaxDate = new Date();
      expectedMaxDate.setDate(expectedMaxDate.getDate() + deadlineDays + 1);

      expect(deadline.getTime()).toBeGreaterThanOrEqual(
        expectedMinDate.getTime()
      );
      expect(deadline.getTime()).toBeLessThanOrEqual(expectedMaxDate.getTime());
    });

    it('should include instructions in review when provided', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);
      
      const instructions =
        'Special instructions: Focus on section 3. Check for code quality.';

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers
            .slice(0, 1)
            .map((m) => m.userId),
          reviewDeadlineDays: 7,
          instructions,
        });

      expect(res.status).toBe(201);
      expect(res.body.instructions).toBe(instructions);

      const review = await Review.findOne({
        reviewId: res.body.reviewId,
      }).lean();
      expect(review.instructions).toBe(instructions);
    });
  });

  describe('Conflict detection', () => {
    it('should return 409 when review already exists for deliverable', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);
      
      // Create first review
      const firstRes = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers
            .slice(0, 1)
            .map((m) => m.userId),
          reviewDeadlineDays: 7,
        });
      expect(firstRes.status).toBe(201);

      // Try to create second review for same deliverable
      const secondRes = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers
            .slice(1, 2)
            .map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.message).toMatch(/already assigned|already exists/i);
    });
  });

  describe('Audit logging', () => {
    it('should create audit log for review assignment', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario = await setupReviewScenario();
      await Deliverable.create(scenario.deliverable);

      const res = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario.deliverable.deliverableId,
          selectedCommitteeMembers: scenario.committeeMembers
            .slice(0, 2)
            .map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(res.status).toBe(201);

      // Allow fire-and-forget audit log to write
      await new Promise((r) => setTimeout(r, 100));

      // Verify audit log created
      const audit = await AuditLog.findOne({
        action: 'REVIEW_ASSIGNED',
        actorId: userId,
        'payload.reviewId': res.body.reviewId,
      }).lean();

      expect(audit).toBeTruthy();
      expect(audit.payload.deliverableId).toBe(scenario.deliverable.deliverableId);
    });
  });

  describe('Multiple test scenarios', () => {
    it('should handle rapid sequential assignments for different deliverables', async () => {
      const { userId, token } = tokenCoordinator();
      const scenario1 = await setupReviewScenario();
      const scenario2 = await setupReviewScenario();
      
      await Deliverable.create([scenario1.deliverable, scenario2.deliverable]);

      const res1 = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario1.deliverable.deliverableId,
          selectedCommitteeMembers: scenario1.committeeMembers
            .slice(0, 1)
            .map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      const res2 = await request(app)
        .post(`${API}/reviews/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          deliverableId: scenario2.deliverable.deliverableId,
          selectedCommitteeMembers: scenario2.committeeMembers
            .slice(0, 1)
            .map((m) => m.userId),
          reviewDeadlineDays: 7,
        });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.reviewId).not.toBe(res2.body.reviewId);

      const review1 = await Review.findOne({
        reviewId: res1.body.reviewId,
      }).lean();
      const review2 = await Review.findOne({
        reviewId: res2.body.reviewId,
      }).lean();

      expect(review1.deliverableId).not.toBe(review2.deliverableId);
    });
  });
});
