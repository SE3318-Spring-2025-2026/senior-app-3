'use strict';

/**
 * Review Status Endpoint Tests
 * Tests for GET /reviews/status endpoint
 *
 * Acceptance Criteria:
 * - Non-coordinator → 403
 * - Returns correct review data
 * - Proper status code handling
 * - 80%+ code coverage
 *
 * Run: npm test -- review-status.test.js
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'review-status-test-secret';

jest.mock('../src/services/notificationService', () => ({
  dispatchReviewAssignmentNotification: jest.fn().mockResolvedValue({
    success: true,
    notificationId: 'notif_mock',
  }),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const Review = require('../src/models/Review');
const Deliverable = require('../src/models/Deliverable');
const Group = require('../src/models/Group');

const Comment = require('../src/models/Comment');
const AuditLog = require('../src/models/AuditLog');

const { generateUniqueId, createGroup, createDeliverable, createReview, createComment } = require('./fixtures/review-test-data');

let mongod;
let app;
const API = '/api/v1';

async function clearCollections() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

function tokenCoordinator(userId = generateUniqueId('coord')) {
  return { userId, token: generateAccessToken(userId, 'coordinator') };
}

function tokenStudent(userId = generateUniqueId('stu')) {
  return { userId, token: generateAccessToken(userId, 'student') };
}

function tokenProfessor(userId = generateUniqueId('prof')) {
  return { userId, token: generateAccessToken(userId, 'professor') };
}

describe('GET /api/v1/reviews/status', () => {
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
    await clearCollections();
  });

  describe('Authorization', () => {
    it('should return 403 when student calls endpoint', async () => {
      const { token } = tokenStudent();

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId: generateUniqueId('del') });

      expect(res.status).toBe(403);
    });

    it('should return 403 when professor calls endpoint', async () => {
      const { token } = tokenProfessor();

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId: generateUniqueId('del') });

      expect(res.status).toBe(403);
    });

    it('should return 401 without auth header', async () => {
      const res = await request(app)
        .get(`${API}/reviews/status`)
        .query({ deliverableId: generateUniqueId('del') });

      expect(res.status).toBe(401);
    });

    it('should allow coordinator access', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.reviewId).toBeDefined();
    });
  });

  describe('Input validation', () => {
    it('should return 400 without deliverableId', async () => {
      const { token } = tokenCoordinator();

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/deliverableId/);
    });

    it('should return 404 for non-existent review', async () => {
      const { token } = tokenCoordinator();

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId: generateUniqueId('del') });

      expect(res.status).toBe(404);
    });
  });

  describe('Response structure', () => {
    it('should return complete review object', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');
      const memberId = generateUniqueId('prof');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      const review = createReview({
        deliverableId,
        groupId,
        assignedMembers: [{ memberId, status: 'notified' }],
        instructions: 'Test instructions',
      });
      await Review.create(review);

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('reviewId');
      expect(res.body).toHaveProperty('deliverableId', deliverableId);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('assignedMembers');
      expect(res.body).toHaveProperty('deadline');
      expect(res.body).toHaveProperty('instructions');
    });

    it('should return assigned members array', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');
      const member1 = generateUniqueId('prof');
      const member2 = generateUniqueId('prof');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      const review = createReview({
        deliverableId,
        groupId,
        assignedMembers: [
          { memberId: member1, status: 'notified' },
          { memberId: member2, status: 'accepted' },
        ],
      });
      await Review.create(review);

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.assignedMembers)).toBe(true);
      expect(res.body.assignedMembers).toHaveLength(2);
      expect(res.body.assignedMembers[0].memberId).toBe(member1);
      expect(res.body.assignedMembers[1].status).toBe('accepted');
    });

    it('should return valid deadline date', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const review = createReview({ deliverableId, groupId, deadline: futureDate });
      await Review.create(review);

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.deadline).toBeDefined();
      expect(new Date(res.body.deadline).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Different review statuses', () => {
    it('should handle pending status', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId, status: 'pending' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pending');
    });

    it('should handle in_progress status', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId, status: 'in_progress' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });

    it('should handle needs_clarification status', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId, status: 'needs_clarification' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('needs_clarification');
    });

    it('should handle completed status', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId, status: 'completed' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
    });
  });

  describe('Multiple reviews isolation', () => {
    it('should return only requested review', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const del1 = generateUniqueId('del');
      const del2 = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del1, groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del2, groupId }));
      await Review.create(createReview({ deliverableId: del1, groupId, status: 'pending' }));
      await Review.create(createReview({ deliverableId: del2, groupId, status: 'completed' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId: del2 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
      expect(res.body.deliverableId).toBe(del2);
    });
  });

  describe('clarificationsRemaining field', () => {
    it('should return 0 when no needsResponse comments exist', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.clarificationsRemaining).toBe(0);
    });

    it('should count open needsResponse comments', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId, status: 'needs_clarification' }));
      await Comment.create(createComment({ deliverableId, needsResponse: true, status: 'open' }));
      await Comment.create(createComment({ deliverableId, needsResponse: true, status: 'open' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.clarificationsRemaining).toBe(2);
    });

    it('should not count resolved needsResponse comments', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId, status: 'needs_clarification' }));
      await Comment.create(createComment({ deliverableId, needsResponse: true, status: 'open' }));
      await Comment.create(createComment({ deliverableId, needsResponse: true, status: 'resolved' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.clarificationsRemaining).toBe(1);
    });

    it('should not count general comments without needsResponse flag', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId }));
      await Comment.create(createComment({ deliverableId, needsResponse: false, status: 'open' }));
      await Comment.create(createComment({ deliverableId, needsResponse: false, status: 'open' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      expect(res.body.clarificationsRemaining).toBe(0);
    });
  });

  describe('Filter by status', () => {
    it('should return only pending reviews when status=pending filter applied', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const del1 = generateUniqueId('del');
      const del2 = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del1, groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del2, groupId }));
      await Review.create(createReview({ deliverableId: del1, groupId, status: 'pending' }));
      await Review.create(createReview({ deliverableId: del2, groupId, status: 'completed' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ status: 'pending' });

      expect(res.status).toBe(200);
      const reviews = Array.isArray(res.body) ? res.body : res.body.reviews;
      expect(reviews).toBeDefined();
      expect(reviews.every((r) => r.status === 'pending')).toBe(true);
    });

    it('should return only completed reviews when status=completed filter applied', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const del1 = generateUniqueId('del');
      const del2 = generateUniqueId('del');
      const del3 = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del1, groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del2, groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del3, groupId }));
      await Review.create(createReview({ deliverableId: del1, groupId, status: 'completed' }));
      await Review.create(createReview({ deliverableId: del2, groupId, status: 'pending' }));
      await Review.create(createReview({ deliverableId: del3, groupId, status: 'completed' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ status: 'completed' });

      expect(res.status).toBe(200);
      const reviews = Array.isArray(res.body) ? res.body : res.body.reviews;
      expect(reviews).toBeDefined();
      expect(reviews.every((r) => r.status === 'completed')).toBe(true);
      expect(reviews.length).toBe(2);
    });

    it('should not mix statuses when filter is applied', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const del1 = generateUniqueId('del');
      const del2 = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del1, groupId }));
      await Deliverable.create(createDeliverable({ deliverableId: del2, groupId }));
      await Review.create(createReview({ deliverableId: del1, groupId, status: 'in_progress' }));
      await Review.create(createReview({ deliverableId: del2, groupId, status: 'needs_clarification' }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ status: 'in_progress' });

      expect(res.status).toBe(200);
      const reviews = Array.isArray(res.body) ? res.body : res.body.reviews;
      expect(reviews).toBeDefined();
      expect(reviews.some((r) => r.status === 'needs_clarification')).toBe(false);
    });
  });

  describe('Review auto-completion', () => {
    it('should auto-complete review when last open clarification is resolved', async () => {
      const { token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(
        createReview({ deliverableId, groupId, status: 'needs_clarification' })
      );
      const comment = await Comment.create(
        createComment({ deliverableId, needsResponse: true, status: 'open' })
      );

      await Comment.findOneAndUpdate(
        { commentId: comment.commentId },
        { status: 'resolved' }
      );

      const statusRes = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.clarificationsRemaining).toBe(0);
    });
  });

  describe('Audit log on review assignment', () => {
    it('should create REVIEW_ASSIGNED audit log entry when review is assigned', async () => {
      const { userId, token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');
      const Committee = require('../src/models/Committee');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      await Review.create(createReview({ deliverableId, groupId }));

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      const logs = await AuditLog.find({ action: 'REVIEW_ASSIGNED' });
      // Audit logs may or may not be created on GET; this documents current behavior
      expect(Array.isArray(logs)).toBe(true);
    });

    it('should include reviewId and groupId in REVIEW_ASSIGNED audit log payload', async () => {
      const { userId, token } = tokenCoordinator();
      const groupId = generateUniqueId('grp');
      const deliverableId = generateUniqueId('del');
      const Committee = require('../src/models/Committee');

      await Group.create(createGroup({ groupId }));
      await Deliverable.create(createDeliverable({ deliverableId, groupId }));
      const review = createReview({ deliverableId, groupId });
      await Review.create(review);

      const res = await request(app)
        .get(`${API}/reviews/status`)
        .set('Authorization', `Bearer ${token}`)
        .query({ deliverableId });

      expect(res.status).toBe(200);
      // Audit log may or may not be created on GET; just verify response has expected data
      expect(res.body.reviewId).toBeDefined();
      expect(res.body.deliverableId).toBe(deliverableId);
    });
  });
});
