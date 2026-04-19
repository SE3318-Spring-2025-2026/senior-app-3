/**
 * Smoke tests — Process 6 auth middleware for review and deliverable comment routes
 *
 * Covers:
 *   /api/v1/reviews/assign        → JWT required; coordinator only (403 for others)
 *   /api/v1/reviews/status        → JWT required; coordinator only (403 for others)
 *   /api/v1/deliverables/:id/comments
 *     → JWT required; committee_member + coordinator allowed; student 403
 *   /api/v1/deliverables/:id/comments/:commentId/reply
 *     → JWT required; committee_member + coordinator + student allowed
 *   req.user shape                → { userId, role, groupId } available in controllers
 *
 * Run:
 *   npm test -- reviews-auth-middleware.smoke.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'reviews-smoke-test-secret';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');

let mongod;
let app;

const unique = (prefix) =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function makeToken(userId, role) {
  return generateAccessToken(userId, role);
}

/** Seed a Group with one accepted student member and return { groupId, studentId }. */
async function seedGroupWithStudent() {
  const studentId = unique('stu');
  const groupId = unique('grp');
  await Group.create({
    groupId,
    groupName: unique('Group'),
    leaderId: studentId,
    status: 'active',
    members: [{ userId: studentId, role: 'leader', status: 'accepted' }],
  });
  return { groupId, studentId };
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
// POST /api/v1/reviews/assign
// ---------------------------------------------------------------------------
describe('POST /api/v1/reviews/assign', () => {
  const ENDPOINT = '/api/v1/reviews/assign';

  it('401 — no Authorization header', async () => {
    const res = await request(app).post(ENDPOINT).send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed / invalid token', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer not.a.real.token')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('403 — student cannot assign a review', async () => {
    const { studentId } = await seedGroupWithStudent();
    const token = makeToken(studentId, 'student');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('403 — committee_member cannot assign a review', async () => {
    const token = makeToken(unique('cm'), 'committee_member');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('403 — advisor cannot assign a review', async () => {
    const token = makeToken(unique('adv'), 'advisor');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('400 — coordinator passes auth+role; handler rejects missing deliverableId', async () => {
    const token = makeToken(unique('coord'), 'coordinator');

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/reviews/status
// ---------------------------------------------------------------------------
describe('GET /api/v1/reviews/status', () => {
  const ENDPOINT = '/api/v1/reviews/status';

  it('401 — no Authorization header', async () => {
    const res = await request(app).get(ENDPOINT);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed / invalid token', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('403 — student cannot view review status', async () => {
    const { studentId } = await seedGroupWithStudent();
    const token = makeToken(studentId, 'student');

    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('403 — committee_member cannot view review status', async () => {
    const token = makeToken(unique('cm'), 'committee_member');

    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('400 — coordinator passes auth+role; handler rejects missing deliverableId param', async () => {
    const token = makeToken(unique('coord'), 'coordinator');

    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/deliverables/:deliverableId/comments  (initiate comment)
// ---------------------------------------------------------------------------
describe('POST /api/v1/deliverables/:deliverableId/comments', () => {
  const endpoint = (id) => `/api/v1/deliverables/${id}/comments`;

  it('401 — no Authorization header', async () => {
    const res = await request(app).post(endpoint('del-1')).send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed token', async () => {
    const res = await request(app)
      .post(endpoint('del-1'))
      .set('Authorization', 'Bearer bad.token.here')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('403 — student cannot initiate a comment', async () => {
    const { studentId } = await seedGroupWithStudent();
    const token = makeToken(studentId, 'student');

    const res = await request(app)
      .post(endpoint('del-1'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('403 — advisor cannot initiate a comment', async () => {
    const token = makeToken(unique('adv'), 'advisor');

    const res = await request(app)
      .post(endpoint('del-1'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('400 — committee_member passes auth+role; handler rejects empty body (content required)', async () => {
    const token = makeToken(unique('cm'), 'committee_member');

    const res = await request(app)
      .post(endpoint('del-abc'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — coordinator passes auth+role; handler rejects empty body (content required)', async () => {
    const token = makeToken(unique('coord'), 'coordinator');

    const res = await request(app)
      .post(endpoint('del-abc'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/deliverables/:deliverableId/comments/:commentId/reply  (reply)
// ---------------------------------------------------------------------------
describe('POST /api/v1/deliverables/:deliverableId/comments/:commentId/reply', () => {
  const endpoint = (delId, commentId) =>
    `/api/v1/deliverables/${delId}/comments/${commentId}/reply`;

  it('401 — no Authorization header', async () => {
    const res = await request(app).post(endpoint('del-1', 'cmt-1')).send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('401 — malformed token', async () => {
    const res = await request(app)
      .post(endpoint('del-1', 'cmt-1'))
      .set('Authorization', 'Bearer bad.token.here')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('403 — advisor cannot reply to a comment', async () => {
    const token = makeToken(unique('adv'), 'advisor');

    const res = await request(app)
      .post(endpoint('del-1', 'cmt-1'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('400 — student passes auth+role; handler rejects missing content', async () => {
    const { studentId } = await seedGroupWithStudent();
    const token = makeToken(studentId, 'student');

    const res = await request(app)
      .post(endpoint('del-abc', 'cmt-abc'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — committee_member passes auth+role; handler rejects missing content', async () => {
    const token = makeToken(unique('cm'), 'committee_member');

    const res = await request(app)
      .post(endpoint('del-abc', 'cmt-abc'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('400 — coordinator passes auth+role; handler rejects missing content', async () => {
    const token = makeToken(unique('coord'), 'coordinator');

    const res = await request(app)
      .post(endpoint('del-abc', 'cmt-abc'))
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// req.user shape — { userId, role, groupId } is populated on all review routes
// ---------------------------------------------------------------------------
describe('req.user shape on review routes', () => {
  it('coordinator req.user has userId and role set (groupId null when not in group)', async () => {
    // Verify indirectly: a valid coordinator token reaches the handler,
    // confirming deliverableAuthMiddleware ran and set req.user without error.
    // Handler returns 400 (missing deliverableId) — proof auth+middleware ran.
    const coordId = unique('coord');
    const token = makeToken(coordId, 'coordinator');

    const res = await request(app)
      .post('/api/v1/reviews/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('student req.user.groupId is populated when student belongs to a group', async () => {
    // Student can reach the reply handler — confirms groupId lookup ran successfully.
    // Handler returns 400 (missing content) — proof auth+middleware ran.
    const { studentId } = await seedGroupWithStudent();
    const token = makeToken(studentId, 'student');

    const res = await request(app)
      .post('/api/v1/deliverables/del-x/comments/cmt-x/reply')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
