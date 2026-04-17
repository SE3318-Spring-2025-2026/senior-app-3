'use strict';

/**
 * Review Comments Tests
 * Comprehensive tests for add comment, get comments, edit/resolve comment, and reply endpoints
 *
 * Coverage:
 * - Student adds comment → 403
 * - Committee member adds clarification_required comment with needsResponse: true → 201, Review status updated
 * - GET returns paginated list with openClarificationCount
 * - Student fetches comments for own group → 200
 * - Student fetches comments for another group → 403
 * - Author edits own comment content → 200
 * - Non-author edits content → 403
 * - Coordinator resolves any comment → 200, Review status updated if no open clarifications remain
 * - Student replies to clarification → 201, comment.status auto-set to 'acknowledged'
 * - Reply on non-existent comment → 404
 *
 * Run: npm test -- review-comments.test.js
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'review-comments-test-secret';

jest.mock('../src/services/notificationService', () => ({
  dispatchClarificationRequiredNotification: jest.fn().mockResolvedValue({
    success: true,
    notificationId: 'notif_mock_clarification',
  }),
  dispatchCommentRepliedNotification: jest.fn().mockResolvedValue({
    success: true,
  }),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const Deliverable = require('../src/models/Deliverable');
const Review = require('../src/models/Review');
const Comment = require('../src/models/Comment');
const AuditLog = require('../src/models/AuditLog');

const {
  generateUniqueId,
  createCoordinator,
  createCommitteeMember,
  createGroup,
  createDeliverable,
  createReview,
  createComment,
  createReply,
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

describe('Review Comments Endpoints', () => {
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

  describe('POST /api/v1/comments - Add Comment', () => {
    describe('Authorization', () => {
      it('should return 403 when student tries to add comment', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: 'Student comment',
            commentType: 'general',
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toContain('permission');
      });

      it('should return 401 when no authorization header', async () => {
        const res = await request(app).post(`${API}/comments`).send({
          deliverableId: generateUniqueId('del'),
          content: 'Test comment',
        });

        expect(res.status).toBe(401);
      });
    });

    describe('Validation', () => {
      it('should return 404 when deliverable not found', async () => {
        const { token } = tokenProfessor();

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: generateUniqueId('del'),
            content: 'Test comment',
            commentType: 'general',
          });

        expect(res.status).toBe(404);
      });

      it('should return 400 when content is empty', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const { token } = tokenProfessor();

        await Deliverable.create(deliverable);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: '',
            commentType: 'general',
          });

        expect(res.status).toBe(400);
      });

      it('should return 400 when content exceeds max length', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const { token } = tokenProfessor();

        await Deliverable.create(deliverable);

        const longContent = 'a'.repeat(5001);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: longContent,
            commentType: 'general',
          });

        expect(res.status).toBe(400);
      });

      it('should return 400 when commentType is invalid', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const { token } = tokenProfessor();

        await Deliverable.create(deliverable);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: 'Test comment',
            commentType: 'invalid_type',
          });

        expect(res.status).toBe(400);
      });
    });

    describe('Success cases', () => {
      it('should create comment with 201 status', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const prof = scenario.committeeMembers[0];
        const { token } = tokenProfessor(prof.userId);

        await Deliverable.create(deliverable);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: 'General committee feedback',
            commentType: 'general',
            sectionNumber: 2,
          });

        expect(res.status).toBe(201);
        expect(res.body.commentId).toBeTruthy();
        expect(res.body.content).toBe('General committee feedback');
        expect(res.body.commentType).toBe('general');
        expect(res.body.status).toBe('open');
        expect(res.body.sectionNumber).toBe(2);
      });

      it('should create clarification_required comment with needsResponse', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const review = createReview({
          deliverableId: deliverable.deliverableId,
          groupId: scenario.group.groupId,
        });
        const prof = scenario.committeeMembers[0];
        const { token } = tokenProfessor(prof.userId);

        await Deliverable.create(deliverable);
        await Review.create(review);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: 'Please clarify section 3.',
            commentType: 'clarification_required',
            needsResponse: true,
          });

        expect(res.status).toBe(201);
        expect(res.body.needsResponse).toBe(true);
        expect(res.body.commentType).toBe('clarification_required');
      });

      it('should update Review status to needs_clarification when clarification comment added', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
          status: 'under_review',
        });
        const review = createReview({
          deliverableId: deliverable.deliverableId,
          groupId: scenario.group.groupId,
          status: 'pending',
        });
        const prof = scenario.committeeMembers[0];
        const { token } = tokenProfessor(prof.userId);

        await Deliverable.create(deliverable);
        await Review.create(review);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: 'Please clarify section 3.',
            commentType: 'clarification_required',
            needsResponse: true,
          });

        expect(res.status).toBe(201);

        // Verify Review status updated
        const updatedReview = await Review.findOne({
          reviewId: review.reviewId,
        }).lean();
        expect(updatedReview.status).toBe('needs_clarification');
      });

      it('should set comment status to acknowledged when student replies', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
          commentType: 'clarification_required',
          needsResponse: true,
          status: 'open',
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        // Student replies
        const replyRes = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: 'We have clarified this in the document.',
          });

        expect(replyRes.status).toBe(201);

        // Verify comment status updated
        const updatedComment = await Comment.findOne({
          commentId: comment.commentId,
        }).lean();
        expect(updatedComment.status).toBe('acknowledged');
      });
    });

    describe('Audit logging', () => {
      it('should create audit log when comment added', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const prof = scenario.committeeMembers[0];
        const { userId, token } = tokenProfessor(prof.userId);

        await Deliverable.create(deliverable);

        const res = await request(app)
          .post(`${API}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            deliverableId: deliverable.deliverableId,
            content: 'Test comment',
            commentType: 'general',
          });

        expect(res.status).toBe(201);

        const audit = await AuditLog.findOne({
          action: 'COMMENT_ADDED',
          actorId: userId,
          'payload.commentId': res.body.commentId,
        }).lean();

        expect(audit).toBeTruthy();
      });
    });
  });

  describe('GET /api/v1/comments - Get Comments Thread', () => {
    describe('Authorization', () => {
      it('should return 200 when student fetches comments for own group', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .get(`${API}/comments`)
          .set('Authorization', `Bearer ${student.token}`)
          .query({ deliverableId: deliverable.deliverableId });

        expect(res.status).toBe(200);
      });

      it('should return 403 when student fetches comments for another group', async () => {
        const scenario1 = await setupReviewScenario();
        const scenario2 = await setupReviewScenario();

        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario1.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario1.committeeMembers[0].userId,
        });
        const student = tokenStudent(scenario2.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .get(`${API}/comments`)
          .set('Authorization', `Bearer ${student.token}`)
          .query({ deliverableId: deliverable.deliverableId });

        expect(res.status).toBe(403);
      });

      it('should return 401 when no authorization header', async () => {
        const res = await request(app)
          .get(`${API}/comments`)
          .query({ deliverableId: generateUniqueId('del') });

        expect(res.status).toBe(401);
      });
    });

    describe('Pagination and filtering', () => {
      it('should return paginated comments list', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comments = [];
        for (let i = 0; i < 25; i++) {
          comments.push(
            createComment({
              deliverableId: deliverable.deliverableId,
              authorId: scenario.committeeMembers[0].userId,
              content: `Comment ${i}`,
            })
          );
        }
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comments);

        const res = await request(app)
          .get(`${API}/comments`)
          .set('Authorization', `Bearer ${student.token}`)
          .query({
            deliverableId: deliverable.deliverableId,
            page: 1,
            limit: 10,
          });

        expect(res.status).toBe(200);
        expect(res.body.comments).toHaveLength(10);
        expect(res.body.total).toBe(25);
        expect(res.body.page).toBe(1);
        expect(res.body.totalPages).toBeGreaterThanOrEqual(3);
      });

      it('should include openClarificationCount in response', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comments = [
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            commentType: 'clarification_required',
            needsResponse: true,
            status: 'open',
          }),
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            commentType: 'clarification_required',
            needsResponse: true,
            status: 'open',
          }),
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            commentType: 'clarification_required',
            needsResponse: true,
            status: 'acknowledged',
          }),
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            commentType: 'general',
          }),
        ];
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comments);

        const res = await request(app)
          .get(`${API}/comments`)
          .set('Authorization', `Bearer ${student.token}`)
          .query({ deliverableId: deliverable.deliverableId });

        expect(res.status).toBe(200);
        expect(res.body.openClarificationCount).toBe(2);
      });

      it('should filter by status when provided', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comments = [
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            status: 'open',
          }),
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            status: 'resolved',
          }),
          createComment({
            deliverableId: deliverable.deliverableId,
            authorId: scenario.committeeMembers[0].userId,
            status: 'open',
          }),
        ];
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comments);

        const res = await request(app)
          .get(`${API}/comments`)
          .set('Authorization', `Bearer ${student.token}`)
          .query({
            deliverableId: deliverable.deliverableId,
            status: 'open',
          });

        expect(res.status).toBe(200);
        expect(res.body.comments).toHaveLength(2);
        expect(res.body.comments.every((c) => c.status === 'open')).toBe(true);
      });
    });
  });

  describe('PATCH /api/v1/comments/:commentId - Edit Comment', () => {
    describe('Authorization', () => {
      it('should return 403 when non-author tries to edit', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const otherProf = tokenProfessor(scenario.committeeMembers[1].userId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .patch(`${API}/comments/${comment.commentId}`)
          .set('Authorization', `Bearer ${otherProf.token}`)
          .send({
            content: 'Modified comment',
          });

        expect(res.status).toBe(403);
      });

      it('should return 401 when no authorization header', async () => {
        const res = await request(app)
          .patch(`${API}/comments/${generateUniqueId('cmt')}`)
          .send({
            content: 'Modified comment',
          });

        expect(res.status).toBe(401);
      });
    });

    describe('Validation', () => {
      it('should return 404 when comment not found', async () => {
        const { token } = tokenProfessor();

        const res = await request(app)
          .patch(`${API}/comments/${generateUniqueId('cmt')}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            content: 'Modified comment',
          });

        expect(res.status).toBe(404);
      });

      it('should return 400 when content is empty', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const prof = tokenProfessor(scenario.committeeMembers[0].userId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .patch(`${API}/comments/${comment.commentId}`)
          .set('Authorization', `Bearer ${prof.token}`)
          .send({
            content: '',
          });

        expect(res.status).toBe(400);
      });
    });

    describe('Success cases', () => {
      it('should edit comment when author updates content', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
          content: 'Original content',
        });
        const prof = tokenProfessor(scenario.committeeMembers[0].userId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .patch(`${API}/comments/${comment.commentId}`)
          .set('Authorization', `Bearer ${prof.token}`)
          .send({
            content: 'Updated content',
          });

        expect(res.status).toBe(200);
        expect(res.body.content).toBe('Updated content');
        expect(res.body.commentId).toBe(comment.commentId);

        const updatedComment = await Comment.findOne({
          commentId: comment.commentId,
        }).lean();
        expect(updatedComment.content).toBe('Updated content');
      });
    });

    describe('Audit logging', () => {
      it('should create audit log when comment edited', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const prof = tokenProfessor(scenario.committeeMembers[0].userId);
        const { userId } = prof;

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .patch(`${API}/comments/${comment.commentId}`)
          .set('Authorization', `Bearer ${prof.token}`)
          .send({
            content: 'Updated content',
          });

        expect(res.status).toBe(200);

        const audit = await AuditLog.findOne({
          action: 'COMMENT_EDITED',
          actorId: userId,
          'payload.commentId': comment.commentId,
        }).lean();

        expect(audit).toBeTruthy();
      });
    });
  });

  describe('POST /api/v1/comments/:commentId/reply - Add Reply', () => {
    describe('Authorization', () => {
      it('should allow student to reply to clarification', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
          commentType: 'clarification_required',
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: 'We have addressed this issue.',
          });

        expect(res.status).toBe(201);
      });

      it('should return 401 when no authorization header', async () => {
        const res = await request(app)
          .post(`${API}/comments/${generateUniqueId('cmt')}/reply`)
          .send({
            content: 'Reply content',
          });

        expect(res.status).toBe(401);
      });
    });

    describe('Validation', () => {
      it('should return 404 when comment not found', async () => {
        const student = tokenStudent();

        const res = await request(app)
          .post(`${API}/comments/${generateUniqueId('cmt')}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: 'Reply content',
          });

        expect(res.status).toBe(404);
      });

      it('should return 400 when reply content is empty', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: '',
          });

        expect(res.status).toBe(400);
      });

      it('should return 400 when reply content exceeds max length', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const longContent = 'a'.repeat(2001);

        const res = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: longContent,
          });

        expect(res.status).toBe(400);
      });
    });

    describe('Success cases', () => {
      it('should add reply and update comment status to acknowledged', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
          status: 'open',
          needsResponse: true,
        });
        const student = tokenStudent(scenario.group.leaderId);

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: 'We have addressed section 3 as requested.',
          });

        expect(res.status).toBe(201);
        expect(res.body.replyId).toBeTruthy();
        expect(res.body.content).toBe('We have addressed section 3 as requested.');

        // Verify comment status updated
        const updatedComment = await Comment.findOne({
          commentId: comment.commentId,
        }).lean();
        expect(updatedComment.status).toBe('acknowledged');
        expect(updatedComment.replies).toHaveLength(1);
        expect(updatedComment.replies[0].authorId).toBe(scenario.group.leaderId);
      });

      it('should allow multiple replies to same comment', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
          members: [
            { userId: scenario.group.leaderId, role: 'leader', status: 'accepted' },
            {
              userId: generateUniqueId('stu'),
              role: 'member',
              status: 'accepted',
            },
          ],
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const student1 = tokenStudent(scenario.group.leaderId);
        const student2 = tokenStudent(generateUniqueId('stu'));

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res1 = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student1.token}`)
          .send({
            content: 'First reply',
          });

        const res2 = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student2.token}`)
          .send({
            content: 'Second reply',
          });

        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);

        const updatedComment = await Comment.findOne({
          commentId: comment.commentId,
        }).lean();
        expect(updatedComment.replies).toHaveLength(2);
      });
    });

    describe('Audit logging', () => {
      it('should create audit log when reply added', async () => {
        const scenario = await setupReviewScenario();
        const deliverable = createDeliverable({
          deliverableId: generateUniqueId('del'),
          groupId: scenario.group.groupId,
        });
        const comment = createComment({
          deliverableId: deliverable.deliverableId,
          authorId: scenario.committeeMembers[0].userId,
        });
        const student = tokenStudent(scenario.group.leaderId);
        const { userId } = student;

        await Deliverable.create(deliverable);
        await Comment.create(comment);

        const res = await request(app)
          .post(`${API}/comments/${comment.commentId}/reply`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({
            content: 'Reply content',
          });

        expect(res.status).toBe(201);

        const audit = await AuditLog.findOne({
          action: 'COMMENT_REPLIED',
          actorId: userId,
          'payload.commentId': comment.commentId,
        }).lean();

        expect(audit).toBeTruthy();
      });
    });
  });

  describe('Coordinator Resolve Comment - PATCH /api/v1/comments/:commentId/resolve', () => {
    it('should allow coordinator to resolve any comment', async () => {
      const scenario = await setupReviewScenario();
      const deliverable = createDeliverable({
        deliverableId: generateUniqueId('del'),
        groupId: scenario.group.groupId,
      });
      const comment = createComment({
        deliverableId: deliverable.deliverableId,
        authorId: scenario.committeeMembers[0].userId,
        status: 'open',
      });
      const coord = tokenCoordinator();

      await Deliverable.create(deliverable);
      await Comment.create(comment);

      const res = await request(app)
        .patch(`${API}/comments/${comment.commentId}/resolve`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('resolved');

      const updatedComment = await Comment.findOne({
        commentId: comment.commentId,
      }).lean();
      expect(updatedComment.status).toBe('resolved');
    });

    it('should update Review status when all clarifications resolved', async () => {
      const scenario = await setupReviewScenario();
      const deliverable = createDeliverable({
        deliverableId: generateUniqueId('del'),
        groupId: scenario.group.groupId,
        status: 'under_review',
      });
      const review = createReview({
        deliverableId: deliverable.deliverableId,
        groupId: scenario.group.groupId,
        status: 'needs_clarification',
      });
      const comment1 = createComment({
        deliverableId: deliverable.deliverableId,
        authorId: scenario.committeeMembers[0].userId,
        commentType: 'clarification_required',
        needsResponse: true,
        status: 'open',
      });
      const comment2 = createComment({
        deliverableId: deliverable.deliverableId,
        authorId: scenario.committeeMembers[0].userId,
        commentType: 'clarification_required',
        needsResponse: true,
        status: 'acknowledged',
      });
      const coord = tokenCoordinator();

      await Deliverable.create(deliverable);
      await Review.create(review);
      await Comment.create([comment1, comment2]);

      // Resolve first comment
      const res = await request(app)
        .patch(`${API}/comments/${comment1.commentId}/resolve`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send();

      expect(res.status).toBe(200);

      // Verify Review status updated to in_progress (no more open clarifications)
      const updatedReview = await Review.findOne({
        reviewId: review.reviewId,
      }).lean();
      expect(updatedReview.status).toBe('in_progress');
    });

    it('should return 403 when non-coordinator tries to resolve', async () => {
      const scenario = await setupReviewScenario();
      const deliverable = createDeliverable({
        deliverableId: generateUniqueId('del'),
        groupId: scenario.group.groupId,
      });
      const comment = createComment({
        deliverableId: deliverable.deliverableId,
        authorId: scenario.committeeMembers[0].userId,
      });
      const student = tokenStudent();

      await Deliverable.create(deliverable);
      await Comment.create(comment);

      const res = await request(app)
        .patch(`${API}/comments/${comment.commentId}/resolve`)
        .set('Authorization', `Bearer ${student.token}`)
        .send();

      expect(res.status).toBe(403);
    });

    it('should return 404 when comment not found', async () => {
      const coord = tokenCoordinator();

      const res = await request(app)
        .patch(`${API}/comments/${generateUniqueId('cmt')}/resolve`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send();

      expect(res.status).toBe(404);
    });
  });
});
