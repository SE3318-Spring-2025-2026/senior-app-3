const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../index');
const User = require('../models/User');
const Committee = require('../models/Committee');
const { generateToken } = require('../utils/jwt');
const AuditLog = require('../models/AuditLog');

describe('Issue #72 — Assign Advisors to Committee (Process 4.2)', () => {
  let coordinator;
  let professor1;
  let professor2;
  let committee;
  let coordinatorToken;
  let studentToken;

  beforeAll(async () => {
    // Connect to test database
    if (!mongoose.connection.db) {
      const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test';
      await mongoose.connect(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
    }

    // Clear collections
    await Promise.all([User.deleteMany({}), Committee.deleteMany({}), AuditLog.deleteMany({})]);

    // Create test users
    coordinator = await User.create({
      email: 'coordinator@test.edu',
      hashedPassword: 'hashed_pass_123',
      role: 'coordinator',
      emailVerified: true,
      accountStatus: 'active',
    });

    professor1 = await User.create({
      email: 'prof1@test.edu',
      hashedPassword: 'hashed_pass_456',
      role: 'professor',
      emailVerified: true,
      accountStatus: 'active',
    });

    professor2 = await User.create({
      email: 'prof2@test.edu',
      hashedPassword: 'hashed_pass_789',
      role: 'professor',
      emailVerified: true,
      accountStatus: 'active',
    });

    const student = await User.create({
      email: 'student@test.edu',
      hashedPassword: 'hashed_pass_000',
      role: 'student',
      emailVerified: true,
      accountStatus: 'active',
    });

    // Generate tokens
    coordinatorToken = generateToken({
      userId: coordinator.userId,
      email: coordinator.email,
      role: coordinator.role,
    });

    studentToken = generateToken({
      userId: student.userId,
      email: student.email,
      role: student.role,
    });

    // Create test committee in draft status
    committee = await Committee.create({
      committeeName: 'Test Committee 1',
      description: 'Test committee for advisor assignment',
      coordinatorId: coordinator.userId,
      status: 'draft',
      advisorIds: [],
      juryIds: [],
    });
  });

  afterAll(async () => {
    await Promise.all([User.deleteMany({}), Committee.deleteMany({}), AuditLog.deleteMany({})]);
    await mongoose.connection.close();
  });

  // ✅ Test 1: Coordinator can assign one or more advisors to a committee draft
  describe('✅ Success Cases', () => {
    test('should assign single advisor to committee draft', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.committee.advisorIds).toContain(professor1.userId);
      expect(response.body.committee.advisorIds.length).toBe(1);

      // Verify in DB
      const updated = await Committee.findOne({ committeeId: committee.committeeId });
      expect(updated.advisorIds).toContain(professor1.userId);
    });

    test('should assign multiple advisors to committee draft', async () => {
      const cmte2 = await Committee.create({
        committeeName: 'Test Committee 2',
        coordinatorId: coordinator.userId,
        status: 'draft',
        advisorIds: [],
        juryIds: [],
      });

      const response = await request(app)
        .post(`/api/v1/committees/${cmte2.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId, professor2.userId] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.committee.advisorIds.length).toBe(2);
      expect(response.body.committee.advisorIds).toContain(professor1.userId);
      expect(response.body.committee.advisorIds).toContain(professor2.userId);
    });

    test('should replace existing advisor assignments', async () => {
      const cmte3 = await Committee.create({
        committeeName: 'Test Committee 3',
        coordinatorId: coordinator.userId,
        status: 'draft',
        advisorIds: [professor1.userId],
        juryIds: [],
      });

      const response = await request(app)
        .post(`/api/v1/committees/${cmte3.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor2.userId] })
        .expect(200);

      expect(response.body.committee.advisorIds).toEqual([professor2.userId]);
    });

    test('should create audit log for advisor assignment', async () => {
      const cmte4 = await Committee.create({
        committeeName: 'Test Committee 4',
        coordinatorId: coordinator.userId,
        status: 'draft',
        advisorIds: [],
        juryIds: [],
      });

      await request(app)
        .post(`/api/v1/committees/${cmte4.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(200);

      const log = await AuditLog.findOne({
        action: 'COMMITTEE_ADVISORS_ASSIGNED',
        targetId: cmte4.committeeId,
      });

      expect(log).toBeDefined();
      expect(log.actorId).toBe(coordinator.userId);
      expect(log.payload.advisorIds).toContain(professor1.userId);
    });

    test('should forward to process 4.4', async () => {
      const cmte5 = await Committee.create({
        committeeName: 'Test Committee 5',
        coordinatorId: coordinator.userId,
        status: 'draft',
        advisorIds: [],
        juryIds: [],
      });

      const response = await request(app)
        .post(`/api/v1/committees/${cmte5.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(200);

      expect(response.body.forwarded).toBe(true);
      expect(response.body.forwardTarget).toBe('Process 4.4 — Committee Setup Validation');

      // Verify forward log exists
      const forwardLog = await AuditLog.findOne({
        action: 'COMMITTEE_ADVISORS_FORWARDED_TO_VALIDATION',
        targetId: cmte5.committeeId,
      });

      expect(forwardLog).toBeDefined();
    });
  });

  // ❌ Test 2: Non-coordinator callers receive 403 Forbidden
  describe('❌ Authorization Failures', () => {
    test('should reject non-coordinator user with 403', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toMatch(/permission/i);
    });

    test('should reject unauthenticated request with 401', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .send({ advisorIds: [professor1.userId] })
        .expect(401);

      expect(response.body.code).toMatch(/UNAUTHORIZED|INVALID/);
    });
  });

  // ❌ Test 3: Committee not found returns 404
  describe('❌ Committee Not Found (404)', () => {
    test('should return 404 for non-existent committee', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/cmte_nonexistent/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(404);

      expect(response.body.code).toBe('COMMITTEE_NOT_FOUND');
    });
  });

  // ❌ Test 4: Invalid advisorId returns 400
  describe('❌ Invalid Advisor Input (400)', () => {
    test('should return 400 for empty advisorIds array', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [] })
        .expect(400);

      expect(response.body.code).toBe('EMPTY_ADVISOR_LIST');
    });

    test('should return 400 for non-existent advisor', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: ['usr_nonexistent'] })
        .expect(400);

      expect(response.body.code).toBe('INVALID_ADVISORS');
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    test('should return 400 if advisor is not professor/admin', async () => {
      const student = await User.findOne({ role: 'student' });
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [student.userId] })
        .expect(400);

      expect(response.body.code).toBe('INVALID_ADVISORS');
    });

    test('should return 400 for duplicate advisorIds', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId, professor1.userId] })
        .expect(400);

      expect(response.body.code).toBe('INVALID_ADVISORS');
    });

    test('should return 400 for invalid input type', async () => {
      const response = await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: 'not_an_array' })
        .expect(400);

      expect(response.body.code).toBe('INVALID_INPUT');
    });
  });

  // ❌ Test 5: Advisor assignment conflict returns 409
  describe('❌ Advisor Conflicts (409)', () => {
    test('should return 409 if advisor already assigned to another committee', async () => {
      // First assign professor1 to committee A
      await request(app)
        .post(`/api/v1/committees/${committee.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] });

      // Try to assign professor1 to committee B
      const cmte6 = await Committee.create({
        committeeName: 'Test Committee 6',
        coordinatorId: coordinator.userId,
        status: 'draft',
        advisorIds: [],
        juryIds: [],
      });

      const response = await request(app)
        .post(`/api/v1/committees/${cmte6.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(409);

      expect(response.body.code).toBe('ADVISOR_CONFLICT');
      expect(response.body.conflicts.length).toBeGreaterThan(0);
    });
  });

  // ✅ Test 6: Updated committee object returned with advisorIds[]
  describe('✅ Response Schema', () => {
    test('should return complete updated committee object', async () => {
      const cmte7 = await Committee.create({
        committeeName: 'Test Committee 7',
        description: 'Test description',
        coordinatorId: coordinator.userId,
        status: 'draft',
        advisorIds: [],
        juryIds: [],
      });

      const response = await request(app)
        .post(`/api/v1/committees/${cmte7.committeeId}/advisors`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({ advisorIds: [professor1.userId] })
        .expect(200);

      const { committee: resp } = response.body;

      expect(resp.committeeId).toBe(cmte7.committeeId);
      expect(resp.committeeName).toBe(cmte7.committeeName);
      expect(resp.description).toBe(cmte7.description);
      expect(resp.advisorIds).toEqual([professor1.userId]);
      expect(resp.juryIds).toEqual([]);
      expect(resp.status).toBe('draft');
      expect(resp.createdAt).toBeDefined();
      expect(resp.updatedAt).toBeDefined();
    });
  });
});
