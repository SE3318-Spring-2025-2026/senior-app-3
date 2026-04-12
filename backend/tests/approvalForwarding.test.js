/**
 * Approval Result Forwarding Integration Tests
 *
 * Tests for the forwardApprovalResults controller (flow f09: 2.4 → 2.5).
 * Covers: happy path, zero results (400), group not found (404), idempotency,
 *         partial forwarding, approved D2 writes, validation.
 *
 * Run: npm test -- approvalForwarding.test.js
 */

const mongoose = require('mongoose');

describe('POST /groups/:groupId/approval-results — forwardApprovalResults', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-approval-forwarding';

  let Group;
  let ApprovalQueue;
  let GroupMembership;
  let forwardApprovalResults;

  // ── Test helpers ─────────────────────────────────────────────────────────────

  const makeReq = (params = {}, body = {}) => ({
    params,
    body,
    user: { userId: 'usr_test', role: 'professor' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const makeGroup = (overrides = {}) =>
    Group.create({ groupName: `Test Group ${Date.now()}-${Math.random()}`, leaderId: 'usr_test', ...overrides });

  const makeResults = (count = 1, decision = 'approved') =>
    Array.from({ length: count }, (_, i) => ({
      student_id: `stu_${i + 1}`,
      decision,
      decided_by: 'cmember_1',
      decided_at: new Date().toISOString(),
    }));

  // ── Setup / teardown ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    // Load modules after DB is ready so they share the same mongoose instance
    Group = require('../src/models/Group');
    ApprovalQueue = require('../src/models/ApprovalQueue');
    GroupMembership = require('../src/models/GroupMembership');
    ({ forwardApprovalResults } = require('../src/controllers/groups'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      Group.deleteMany({}),
      ApprovalQueue.deleteMany({}),
      GroupMembership.deleteMany({}),
    ]);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('returns forwarded_count, queued_request_ids, and processed_at', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        { notification_id: 'notif_001', results: makeResults(2, 'approved') }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.forwarded_count).toBe(2);
      expect(body.queued_request_ids).toHaveLength(2);
      expect(body.processed_at).toBeDefined();
    });

    it('creates ApprovalQueue entries for each result', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        { notification_id: 'notif_002', results: makeResults(3, 'approved') }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      const count = await ApprovalQueue.countDocuments({ groupId: group.groupId });
      expect(count).toBe(3);
    });

    it('creates GroupMembership D2 records for approved decisions', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        { notification_id: 'notif_003', results: makeResults(2, 'approved') }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      const memberships = await GroupMembership.find({
        groupId: group.groupId,
        status: 'approved',
      });
      expect(memberships).toHaveLength(2);
    });

    it('does NOT create D2 records for rejected decisions', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        { notification_id: 'notif_004', results: makeResults(2, 'rejected') }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      const memberships = await GroupMembership.countDocuments({ groupId: group.groupId });
      expect(memberships).toBe(0);
      const queued = await ApprovalQueue.countDocuments({ groupId: group.groupId });
      expect(queued).toBe(2);
    });

    it('handles mixed approved and rejected results', async () => {
      const group = await makeGroup();
      const results = [
        { student_id: 'stu_1', decision: 'approved', decided_by: 'cm_1', decided_at: new Date().toISOString() },
        { student_id: 'stu_2', decision: 'rejected', decided_by: 'cm_1', decided_at: new Date().toISOString() },
        { student_id: 'stu_3', decision: 'approved', decided_by: 'cm_1', decided_at: new Date().toISOString() },
      ];
      const req = makeReq({ groupId: group.groupId }, { notification_id: 'notif_005', results });
      const res = makeRes();

      await forwardApprovalResults(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.forwarded_count).toBe(3);
      const approved = await GroupMembership.countDocuments({ groupId: group.groupId, status: 'approved' });
      expect(approved).toBe(2);
    });

    it('queued_request_ids contain valid aq_ prefixed IDs', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        { notification_id: 'notif_006', results: makeResults(2, 'approved') }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      const body = res.json.mock.calls[0][0];
      for (const id of body.queued_request_ids) {
        expect(id).toMatch(/^aq_/);
      }
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────────

  describe('idempotency — same notification_id', () => {
    it('returns forwarded_count=0 when same notification_id and results are re-sent', async () => {
      const group = await makeGroup();
      const body = { notification_id: 'notif_idem_001', results: makeResults(2, 'approved') };

      const res1 = makeRes();
      await forwardApprovalResults(makeReq({ groupId: group.groupId }, body), res1);
      expect(res1.json.mock.calls[0][0].forwarded_count).toBe(2);

      const res2 = makeRes();
      await forwardApprovalResults(makeReq({ groupId: group.groupId }, body), res2);
      const second = res2.json.mock.calls[0][0];
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(second.forwarded_count).toBe(0);
      expect(second.queued_request_ids).toHaveLength(0);
    });

    it('does not create duplicate ApprovalQueue entries on repeat call', async () => {
      const group = await makeGroup();
      const body = { notification_id: 'notif_idem_002', results: makeResults(2, 'approved') };

      await forwardApprovalResults(makeReq({ groupId: group.groupId }, body), makeRes());
      await forwardApprovalResults(makeReq({ groupId: group.groupId }, body), makeRes());

      const count = await ApprovalQueue.countDocuments({ notificationId: 'notif_idem_002' });
      expect(count).toBe(2);
    });

    it('does not duplicate D2 membership records on repeat call', async () => {
      const group = await makeGroup();
      const body = { notification_id: 'notif_idem_003', results: makeResults(2, 'approved') };

      await forwardApprovalResults(makeReq({ groupId: group.groupId }, body), makeRes());
      await forwardApprovalResults(makeReq({ groupId: group.groupId }, body), makeRes());

      const count = await GroupMembership.countDocuments({ groupId: group.groupId });
      expect(count).toBe(2);
    });
  });

  // ── Partial forwarding ────────────────────────────────────────────────────────

  describe('partial forwarding — same notification_id, additional results', () => {
    it('only enqueues new student entries on subsequent calls', async () => {
      const group = await makeGroup();
      const firstBatch = [
        { student_id: 'stu_1', decision: 'approved', decided_by: 'cm_1', decided_at: new Date().toISOString() },
      ];
      const secondBatch = [
        { student_id: 'stu_1', decision: 'approved', decided_by: 'cm_1', decided_at: new Date().toISOString() },
        { student_id: 'stu_2', decision: 'approved', decided_by: 'cm_1', decided_at: new Date().toISOString() },
      ];

      const res1 = makeRes();
      await forwardApprovalResults(
        makeReq({ groupId: group.groupId }, { notification_id: 'notif_partial_001', results: firstBatch }),
        res1
      );
      expect(res1.json.mock.calls[0][0].forwarded_count).toBe(1);

      const res2 = makeRes();
      await forwardApprovalResults(
        makeReq({ groupId: group.groupId }, { notification_id: 'notif_partial_001', results: secondBatch }),
        res2
      );
      expect(res2.json.mock.calls[0][0].forwarded_count).toBe(1);

      const total = await ApprovalQueue.countDocuments({ notificationId: 'notif_partial_001' });
      expect(total).toBe(2);
    });
  });

  // ── 400 Bad Request ───────────────────────────────────────────────────────────

  describe('400 Bad Request', () => {
    it('returns 400 EMPTY_RESULTS when results array is empty', async () => {
      const group = await makeGroup();
      const req = makeReq({ groupId: group.groupId }, { notification_id: 'notif_bad_1', results: [] });
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('EMPTY_RESULTS');
    });

    it('returns 400 EMPTY_RESULTS when results is missing', async () => {
      const group = await makeGroup();
      const req = makeReq({ groupId: group.groupId }, { notification_id: 'notif_bad_2' });
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('EMPTY_RESULTS');
    });

    it('returns 400 MISSING_NOTIFICATION_ID when notification_id is missing', async () => {
      const group = await makeGroup();
      const req = makeReq({ groupId: group.groupId }, { results: makeResults(1) });
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_NOTIFICATION_ID');
    });

    it('returns 400 INVALID_RESULT when decision is invalid', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_bad_3',
          results: [
            { student_id: 'stu_1', decision: 'maybe', decided_by: 'cm_1', decided_at: new Date().toISOString() },
          ],
        }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_RESULT');
    });

    it('returns 400 INVALID_RESULT when student_id is missing', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_bad_4',
          results: [
            { decision: 'approved', decided_by: 'cm_1', decided_at: new Date().toISOString() },
          ],
        }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_RESULT');
    });

    it('returns 400 INVALID_RESULT when decided_at is not a valid date', async () => {
      const group = await makeGroup();
      const req = makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_bad_5',
          results: [
            { student_id: 'stu_1', decision: 'approved', decided_by: 'cm_1', decided_at: 'not-a-date' },
          ],
        }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_RESULT');
    });
  });

  // ── 404 Not Found ─────────────────────────────────────────────────────────────

  describe('404 Not Found', () => {
    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const req = makeReq(
        { groupId: 'grp_nonexistent' },
        { notification_id: 'notif_404', results: makeResults(1) }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });
  });
});
