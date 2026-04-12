/**
 * Process 4.0 — Committee assignment & deliverable submission (integration)
 *
 * Hits real Express routes via supertest (no direct controller invocation).
 * Uses MongoMemoryReplSet (single-node) so MongoDB transactions used by publish
 * and deliverable submission succeed (same requirement as production replica sets).
 *
 * Audit action names in code (AuditLog.action enum):
 *   committee_created      → COMMITTEE_CREATED
 *   advisors_assigned      → COMMITTEE_ADVISORS_ASSIGNED
 *   jury_assigned          → COMMITTEE_JURY_ASSIGNED
 *   committee_published    → COMMITTEE_PUBLISHED
 *   groups linked on publish → GROUPS_LINKED_TO_COMMITTEE (when assignedGroupIds non-empty)
 *   deliverable_submitted  → DELIVERABLE_SUBMITTED
 *
 * D6 / f13: SprintRecord.committeeId and deliverable cross-refs are written inside
 * `deliverableService.submitDeliverable` (not in committee publish), matching the
 * current API; see deliverable submission tests for D4/D6 assertions.
 *
 * Run: npm test -- committee-integration.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-jwt-secret';

jest.mock('../src/services/notificationService', () => {
  const actual = jest.requireActual('../src/services/notificationService');
  return {
    ...actual,
    dispatchCommitteePublishNotification: jest.fn().mockResolvedValue({
      success: true,
      notificationId: 'notif_mock_committee_publish',
    }),
  };
});

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { generateAccessToken } = require('../src/utils/jwt');

const Committee = require('../src/models/Committee');
const Group = require('../src/models/Group');
const Deliverable = require('../src/models/Deliverable');
const SprintRecord = require('../src/models/SprintRecord');
const AuditLog = require('../src/models/AuditLog');
const ScheduleWindow = require('../src/models/ScheduleWindow');

let mongoReplSet;
let app;

const API = '/api/v1';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

async function clearAllCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

function tokenCoordinator(userId = unique('coord')) {
  return { userId, token: generateAccessToken(userId, 'coordinator') };
}

function tokenStudent(userId = unique('stu')) {
  return { userId, token: generateAccessToken(userId, 'student') };
}

async function seedActiveDeliverableWindow() {
  const now = Date.now();
  return ScheduleWindow.create({
    operationType: 'deliverable_submission',
    startsAt: new Date(now - 60_000),
    endsAt: new Date(now + 3_600_000),
    isActive: true,
    createdBy: 'coord_seed',
  });
}

async function createPublishedCommitteeWithGroup(ctx) {
  const coord = tokenCoordinator(ctx?.coordId);
  const student = tokenStudent(ctx?.studentId);

  const gName = unique('Group');
  const groupId = ctx?.groupId || unique('grp');
  const sprintId = ctx?.sprintId || unique('spr');

  await Group.create({
    groupId,
    groupName: gName,
    leaderId: student.userId,
    status: 'active',
    members: [{ userId: student.userId, role: 'leader', status: 'accepted' }],
  });

  const createRes = await request(app)
    .post(`${API}/committees`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ committeeName: unique('Committee'), description: 'integration seed' });
  expect(createRes.status).toBe(201);
  const committeeId = createRes.body.committeeId;

  const advId = unique('prof_adv');
  const jurId = unique('prof_jur');

  await request(app)
    .post(`${API}/committees/${committeeId}/advisors`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ advisorIds: [advId] });

  await request(app)
    .post(`${API}/committees/${committeeId}/jury`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ juryIds: [jurId] });

  const valRes = await request(app)
    .post(`${API}/committees/${committeeId}/validate`)
    .set('Authorization', `Bearer ${coord.token}`);
  expect(valRes.body.valid).toBe(true);

  const pubRes = await request(app)
    .post(`${API}/committees/${committeeId}/publish`)
    .set('Authorization', `Bearer ${coord.token}`)
    .send({ assignedGroupIds: [groupId] });
  expect(pubRes.status).toBe(200);

  return {
    coord,
    student,
    committeeId,
    groupId,
    sprintId,
  };
}

describe('Committee & deliverable integration (Process 4.0)', () => {
  beforeAll(async () => {
    // Replica set required: committee publish + deliverable submission use Mongo transactions
    mongoReplSet = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    await mongoose.connect(mongoReplSet.getUri());
    app = require('../src/index');
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoReplSet) await mongoReplSet.stop();
  });

  afterEach(async () => {
    await clearAllCollections();
    jest.clearAllMocks();
  });

  describe('Setup & authorization helpers', () => {
    it('exposes JWT helpers for coordinator and student roles', () => {
      const c = tokenCoordinator('coord_fixed_1');
      const s = tokenStudent('stu_fixed_1');
      expect(c.token.split('.')).toHaveLength(3);
      expect(s.token.split('.')).toHaveLength(3);
    });
  });

  describe('POST /api/v1/committees', () => {
    it('creates a draft committee (201), persists D3, and writes COMMITTEE_CREATED audit', async () => {
      const { userId, token } = tokenCoordinator();

      const res = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${token}`)
        .send({ committeeName: unique('Alpha Committee'), description: 'desc' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.committeeId).toBeTruthy();

      const doc = await Committee.findOne({ committeeId: res.body.committeeId }).lean();
      expect(doc).toBeTruthy();
      expect(doc.committeeName).toBe(res.body.committeeName);
      expect(doc.status).toBe('draft');

      const audit = await AuditLog.findOne({
        action: 'COMMITTEE_CREATED',
        actorId: userId,
        'payload.committeeId': res.body.committeeId,
      }).lean();
      expect(audit).toBeTruthy();
    });

    it('returns 409 when committee name already exists', async () => {
      const { token } = tokenCoordinator();
      const name = unique('DupName');

      const first = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${token}`)
        .send({ committeeName: name });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${token}`)
        .send({ committeeName: name });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('DUPLICATE_COMMITTEE_NAME');
    });

    it('returns 400 when committee name is missing or empty', async () => {
      const { token } = tokenCoordinator();

      const a = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(a.status).toBe(400);

      const b = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${token}`)
        .send({ committeeName: '   ' });
      expect(b.status).toBe(400);
    });

    it('returns 403 when caller is not a coordinator', async () => {
      const { token } = tokenStudent();

      const res = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${token}`)
        .send({ committeeName: unique('Should Fail') });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /committees/:id/advisors and /jury', () => {
    it('assigns advisors and jury (200), updates D3, and writes COMMITTEE_ADVISORS_ASSIGNED / COMMITTEE_JURY_ASSIGNED', async () => {
      const coord = tokenCoordinator();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('C1'), description: 'x' });
      const committeeId = created.body.committeeId;

      const advIds = [unique('adv_a'), unique('adv_b')];
      const advRes = await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: advIds });

      expect(advRes.status).toBe(200);
      expect(advRes.body.advisorIds.sort()).toEqual(advIds.sort());

      let c = await Committee.findOne({ committeeId }).lean();
      expect(c.advisorIds.sort()).toEqual(advIds.sort());

      let auditAdv = await AuditLog.findOne({
        action: 'COMMITTEE_ADVISORS_ASSIGNED',
        actorId: coord.userId,
        'payload.committeeId': committeeId,
      }).lean();
      expect(auditAdv).toBeTruthy();

      const jurIds = [unique('jur_a')];
      const jurRes = await request(app)
        .post(`${API}/committees/${committeeId}/jury`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ juryIds: jurIds });

      expect(jurRes.status).toBe(200);
      expect(jurRes.body.juryIds).toEqual(jurIds);

      c = await Committee.findOne({ committeeId }).lean();
      expect(c.juryIds).toEqual(jurIds);

      const auditJur = await AuditLog.findOne({
        action: 'COMMITTEE_JURY_ASSIGNED',
        actorId: coord.userId,
        'payload.committeeId': committeeId,
      }).lean();
      expect(auditJur).toBeTruthy();
    });

    it('returns 400 for empty advisor or jury lists', async () => {
      const coord = tokenCoordinator();
      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('C2') });
      const committeeId = created.body.committeeId;

      const a = await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: [] });
      expect(a.status).toBe(400);

      const b = await request(app)
        .post(`${API}/committees/${committeeId}/jury`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ juryIds: [] });
      expect(b.status).toBe(400);
    });

    it('returns 403 when caller is not a coordinator', async () => {
      const coord = tokenCoordinator();
      const student = tokenStudent();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('C3') });
      const committeeId = created.body.committeeId;

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ advisorIds: [unique('adv')] });

      expect(res.status).toBe(403);
    });

    it('returns 404 when committee id does not exist', async () => {
      const coord = tokenCoordinator();

      const res = await request(app)
        .post(`${API}/committees/COM-missing-999/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: [unique('adv')] });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /committees/:id/validate', () => {
    it('returns valid:false with missingRequirements for an incomplete committee', async () => {
      const coord = tokenCoordinator();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('Incomplete') });
      const committeeId = created.body.committeeId;

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/validate`)
        .set('Authorization', `Bearer ${coord.token}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(Array.isArray(res.body.missingRequirements)).toBe(true);
      expect(res.body.missingRequirements.length).toBeGreaterThan(0);

      const c = await Committee.findOne({ committeeId }).lean();
      expect(c.status).toBe('draft');
    });

    it('returns valid:true and transitions D3 to validated when requirements are met', async () => {
      const coord = tokenCoordinator();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('Complete') });
      const committeeId = created.body.committeeId;

      await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: [unique('adv1')] });

      await request(app)
        .post(`${API}/committees/${committeeId}/jury`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ juryIds: [unique('jur1')] });

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/validate`)
        .set('Authorization', `Bearer ${coord.token}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.missingRequirements).toEqual([]);

      const c = await Committee.findOne({ committeeId }).lean();
      expect(c.status).toBe('validated');
    });

    it('returns 403 when caller is not a coordinator', async () => {
      const coord = tokenCoordinator();
      const student = tokenStudent();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('Val403') });
      const committeeId = created.body.committeeId;

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/validate`)
        .set('Authorization', `Bearer ${student.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /committees/:id/publish', () => {
    it('publishes a validated committee (200), updates D2 groups with committeeId, and records COMMITTEE_PUBLISHED audit', async () => {
      const coord = tokenCoordinator();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('PubOk') });
      const committeeId = created.body.committeeId;

      const g1 = unique('grp_pub_1');
      const g2 = unique('grp_pub_2');
      await Group.create({
        groupId: g1,
        groupName: unique('G1'),
        leaderId: coord.userId,
        status: 'active',
      });
      await Group.create({
        groupId: g2,
        groupName: unique('G2'),
        leaderId: coord.userId,
        status: 'active',
      });

      await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: [unique('adv')] });

      await request(app)
        .post(`${API}/committees/${committeeId}/jury`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ juryIds: [unique('jur')] });

      await request(app)
        .post(`${API}/committees/${committeeId}/validate`)
        .set('Authorization', `Bearer ${coord.token}`);

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [g1, g2] });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('published');

      const g1Doc = await Group.findOne({ groupId: g1 }).lean();
      const g2Doc = await Group.findOne({ groupId: g2 }).lean();
      expect(g1Doc.committeeId).toBe(committeeId);
      expect(g2Doc.committeeId).toBe(committeeId);
      expect(g1Doc.committeePublishedAt).toBeTruthy();
      expect(g2Doc.committeePublishedAt).toBeTruthy();

      const audit = await AuditLog.findOne({
        action: 'COMMITTEE_PUBLISHED',
        targetId: committeeId,
        actorId: coord.userId,
      }).lean();
      expect(audit).toBeTruthy();

      const linked = await AuditLog.findOne({
        action: 'GROUPS_LINKED_TO_COMMITTEE',
        targetId: committeeId,
      }).lean();
      expect(linked).toBeTruthy();
    });

    it('returns 400 when committee is not validated', async () => {
      const coord = tokenCoordinator();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('DraftPub') });
      const committeeId = created.body.committeeId;

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [] });

      expect(res.status).toBe(400);
    });

    it('returns 409 when committee is already published', async () => {
      const coord = tokenCoordinator();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('Twice') });
      const committeeId = created.body.committeeId;

      const gid = unique('grp_twice');
      await Group.create({
        groupId: gid,
        groupName: unique('GTwice'),
        leaderId: coord.userId,
        status: 'active',
      });

      await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: [unique('adv')] });
      await request(app)
        .post(`${API}/committees/${committeeId}/jury`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ juryIds: [unique('jur')] });
      await request(app)
        .post(`${API}/committees/${committeeId}/validate`)
        .set('Authorization', `Bearer ${coord.token}`);

      const first = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [gid] });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ assignedGroupIds: [gid] });
      expect(second.status).toBe(409);
    });

    it('returns 403 when caller is not a coordinator', async () => {
      const coord = tokenCoordinator();
      const student = tokenStudent();

      const created = await request(app)
        .post(`${API}/committees`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ committeeName: unique('Pub403') });
      const committeeId = created.body.committeeId;

      await request(app)
        .post(`${API}/committees/${committeeId}/advisors`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ advisorIds: [unique('adv')] });
      await request(app)
        .post(`${API}/committees/${committeeId}/jury`)
        .set('Authorization', `Bearer ${coord.token}`)
        .send({ juryIds: [unique('jur')] });
      await request(app)
        .post(`${API}/committees/${committeeId}/validate`)
        .set('Authorization', `Bearer ${coord.token}`);

      const res = await request(app)
        .post(`${API}/committees/${committeeId}/publish`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ assignedGroupIds: [] });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/groups/:groupId/deliverables', () => {
    it('returns 403 when deliverable_submission schedule window is closed (middleware)', async () => {
      const { student, groupId, committeeId, sprintId } = await createPublishedCommitteeWithGroup();

      const res = await request(app)
        .post(`${API}/groups/${groupId}/deliverables`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          committeeId,
          sprintId,
          type: 'proposal',
          storageRef: 'https://storage.example.com/file.pdf',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('returns 400 when group is not linked to a published committee', async () => {
      await seedActiveDeliverableWindow();

      const student = tokenStudent();
      const groupId = unique('grp_orphan');

      await Group.create({
        groupId,
        groupName: unique('Orphan'),
        leaderId: student.userId,
        status: 'active',
        members: [{ userId: student.userId, role: 'leader', status: 'accepted' }],
      });

      const res = await request(app)
        .post(`${API}/groups/${groupId}/deliverables`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          committeeId: 'COM-any',
          sprintId: unique('spr'),
          type: 'proposal',
          storageRef: 'https://storage.example.com/file.pdf',
        });

      expect(res.status).toBe(400);
    });

    it('returns 403 when body committeeId does not match the group assignment', async () => {
      await seedActiveDeliverableWindow();
      const { student, groupId, sprintId } = await createPublishedCommitteeWithGroup();

      const res = await request(app)
        .post(`${API}/groups/${groupId}/deliverables`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          committeeId: 'COM-wrong-id',
          sprintId,
          type: 'proposal',
          storageRef: 'https://storage.example.com/file.pdf',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('COMMITTEE_MISMATCH');
    });

    it('creates D4 deliverable, updates D6 sprint record (f12–f14), and writes DELIVERABLE_SUBMITTED audit', async () => {
      await seedActiveDeliverableWindow();
      const { student, committeeId, groupId, sprintId } = await createPublishedCommitteeWithGroup();

      const res = await request(app)
        .post(`${API}/groups/${groupId}/deliverables`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          committeeId,
          sprintId,
          type: 'proposal',
          storageRef: 'https://storage.example.com/proposal.pdf',
        });

      expect(res.status).toBe(201);
      expect(res.body.deliverableId).toBeTruthy();
      expect(res.body.groupId).toBe(groupId);
      expect(res.body.committeeId).toBe(committeeId);

      const d4 = await Deliverable.findOne({ deliverableId: res.body.deliverableId }).lean();
      expect(d4).toBeTruthy();
      expect(d4.committeeId).toBe(committeeId);
      expect(d4.groupId).toBe(groupId);
      expect(d4.studentId).toBe(student.userId);

      const d6 = await SprintRecord.findOne({ sprintId, groupId }).lean();
      expect(d6).toBeTruthy();
      expect(d6.committeeId).toBe(committeeId);
      expect(d6.deliverableRefs.some((r) => r.deliverableId === res.body.deliverableId)).toBe(true);

      const audit = await AuditLog.findOne({
        action: 'DELIVERABLE_SUBMITTED',
        actorId: student.userId,
        groupId,
        'payload.deliverableId': res.body.deliverableId,
      }).lean();
      expect(audit).toBeTruthy();
    });
  });
});
