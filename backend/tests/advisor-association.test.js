/**
 * Advisor Association Tests
 * 
 * Tests for Issue #66 (Coordinator Panel - Advisor Association View)
 * Covers Process 3.6 transfers and Process 3.7 sanitization
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/index');
const Group = require('../src/models/Group');
const User = require('../src/models/User');
const ScheduleWindow = require('../src/models/ScheduleWindow');
const AuditLog = require('../src/models/AuditLog');
const { generateToken } = require('../src/utils/jwt');

describe('Issue #66 — Advisor Association (Process 3.6 & 3.7)', () => {
  let coordinator;
  let professor1;
  let professor2;
  let group1;
  let group2;
  let coordinatorToken;
  let professorToken;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-advisor';
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    // Clear collections
    await Promise.all([
      User.deleteMany({}),
      Group.deleteMany({}),
      ScheduleWindow.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);

    // Create test users
    coordinator = await User.create({
      email: 'coordinator@test.edu',
      hashedPassword: 'hashed',
      role: 'coordinator',
      accountStatus: 'active',
    });

    professor1 = await User.create({
      email: 'prof1@test.edu',
      hashedPassword: 'hashed',
      role: 'professor',
      accountStatus: 'active',
    });

    professor2 = await User.create({
      email: 'prof2@test.edu',
      hashedPassword: 'hashed',
      role: 'professor',
      accountStatus: 'active',
    });

    // Create test groups
    const student = await User.create({
      email: 'student@test.edu',
      hashedPassword: 'hashed',
      role: 'student',
      accountStatus: 'active',
    });

    group1 = await Group.create({
      groupName: 'Test Group 1',
      leaderId: student.userId,
      status: 'active',
      advisorStatus: 'pending',
      professorId: null,
    });

    group2 = await Group.create({
      groupName: 'Test Group 2',
      leaderId: student.userId,
      status: 'active',
      advisorStatus: 'assigned',
      professorId: professor1.userId,
    });

    // Create schedule window (open)
    const now = new Date();
    await ScheduleWindow.create({
      operation_type: 'advisor_association',
      open_at: new Date(now.getTime() - 3600000), // 1 hour ago
      close_at: new Date(now.getTime() + 3600000), // 1 hour from now
    });

    // Generate tokens
    coordinatorToken = generateToken({
      userId: coordinator.userId,
      email: coordinator.email,
      role: coordinator.role,
    });

    professorToken = generateToken({
      userId: professor1.userId,
      email: professor1.email,
      role: professor1.role,
    });
  });

  // ✅ Test Group 1: Transfer Advisor (Process 3.6)
  describe('[Process 3.6] Coordinator Transfer Advisor', () => {
    test('should transfer advisor successfully with valid input', async () => {
      const response = await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: professor1.userId,
          coordinatorId: coordinator.userId,
          reason: 'Academic expertise required',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.group.professorId).toBe(professor1.userId);
      expect(response.body.group.advisorStatus).toBe('transferred');

      // Verify DB update
      const updated = await Group.findOne({ groupId: group1.groupId });
      expect(updated.professorId).toBe(professor1.userId);
      expect(updated.advisorStatus).toBe('transferred');
    });

    test('should reject transfer when schedule window is closed', async () => {
      // Close schedule window
      await ScheduleWindow.updateOne(
        { operation_type: 'advisor_association' },
        {
          open_at: new Date(Date.now() - 7200000), // 2 hours ago
          close_at: new Date(Date.now() - 3600000), // 1 hour ago (now closed)
        }
      );

      const response = await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: professor1.userId,
        })
        .expect(422);

      expect(response.body.code).toBe('SCHEDULE_CLOSED');
    });

    test('should return 403 if non-coordinator tries to transfer', async () => {
      const response = await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          newProfessorId: professor1.userId,
        })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    test('should return 404 if group not found', async () => {
      const response = await request(app)
        .post(`/api/v1/groups/grp_nonexistent/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: professor1.userId,
        })
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    test('should return 400 if professor not found', async () => {
      const response = await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: 'usr_nonexistent',
        })
        .expect(400);

      expect(response.body.code).toBe('INVALID_ADVISOR');
    });

    test('should return 409 if professor already assigned to group', async () => {
      const response = await request(app)
        .post(`/api/v1/groups/${group2.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: professor1.userId, // Same as current
        })
        .expect(409);

      expect(response.body.code).toBe('CONFLICT');
    });

    test('should create audit log for transfer', async () => {
      await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: professor1.userId,
          reason: 'Test audit',
        })
        .expect(200);

      const auditLog = await AuditLog.findOne({
        entityType: 'Group',
        entityId: group1.groupId,
        action: 'advisor_transfer',
      });

      expect(auditLog).toBeDefined();
      expect(auditLog.payload.newProfessorId).toBe(professor1.userId);
    });
  });

  // ✅ Test Group 2: Sanitization (Process 3.7)
  describe('[Process 3.7] Disband Unassigned Groups', () => {
    test('should disband unassigned groups successfully', async () => {
      // Create another unassigned group
      const group3 = await Group.create({
        groupName: 'Unassigned Group',
        leaderId: (await User.findOne({ role: 'student' })).userId,
        status: 'active',
        advisorStatus: 'released',
        professorId: null,
      });

      const response = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.code).toBe('SANITIZATION_COMPLETE');
      expect(response.body.count).toBeGreaterThan(0);
      expect(response.body.disbandedGroups).toContain(group1.groupId);

      // Verify DB update
      const updated = await Group.findOne({ groupId: group1.groupId });
      expect(updated.advisorStatus).toBe('disbanded');
    });

    test('should return 403 if non-coordinator or admin tries to sanitize', async () => {
      const response = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set('Authorization', `Bearer ${professorToken}`)
        .send({})
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    test('should return 409 if deadline not passed', async () => {
      // Set deadline in the future
      const futureDeadline = new Date(Date.now() + 3600000);

      const response = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          scheduleDeadline: futureDeadline.toISOString(),
        })
        .expect(409);

      expect(response.body.code).toBe('DEADLINE_NOT_PASSED');
    });

    test('should create audit log for sanitization', async () => {
      await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({})
        .expect(200);

      const auditLog = await AuditLog.findOne({
        entityType: 'System',
        action: 'sanitization_run',
      });

      expect(auditLog).toBeDefined();
      expect(auditLog.payload.disbandedCount).toBeGreaterThanOrEqual(0);
    });

    test('should return 0 count if no unassigned groups', async () => {
      // Assign all groups
      await Group.updateMany({}, {
        advisorStatus: 'assigned',
        professorId: professor1.userId,
      });

      const response = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({})
        .expect(200);

      expect(response.body.count).toBe(0);
    });
  });

  // ✅ Test Group 3: Edge Cases & Validation
  describe('Validation & Edge Cases', () => {
    test('should require newProfessorId for transfer', async () => {
      const response = await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({})
        .expect(400);

      expect(response.body.code).toBe('INVALID_INPUT');
    });

    test('should update advisorUpdatedAt timestamp', async () => {
      await request(app)
        .post(`/api/v1/groups/${group1.groupId}/advisor/transfer`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          newProfessorId: professor1.userId,
        })
        .expect(200);

      const updated = await Group.findOne({ groupId: group1.groupId });
      expect(updated.advisorUpdatedAt).toBeDefined();
      expect(updated.advisorUpdatedAt).toBeInstanceOf(Date);
    });

    test('should handle admin role for sanitization', async () => {
      const admin = await User.create({
        email: 'admin@test.edu',
        hashedPassword: 'hashed',
        role: 'admin',
        accountStatus: 'active',
      });

      const adminToken = generateToken({
        userId: admin.userId,
        email: admin.email,
        role: admin.role,
      });

      const response = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});
