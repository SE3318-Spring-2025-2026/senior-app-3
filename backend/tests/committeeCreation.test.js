/**
 * Committee Creation Tests — Process 4.1
 * POST /committees
 * DFD Flows: f01 (Coordinator → 4.1), f02 (4.1 → 4.2)
 *
 * Coverage:
 *  Unit  — createCommittee controller (mocked DB)
 *  Integ — D3 write, duplicate check, f02 forwarding flag
 *
 * Run: npm test -- committeeCreation.test.js
 */

const mongoose = require('mongoose');

// ─── Shared mock helpers ──────────────────────────────────────────────────────

const makeReq = (body = {}, userOverrides = {}) => ({
  body,
  user: { userId: 'usr_coord_01', role: 'coordinator', ...userOverrides },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest-test-agent' },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
};

// ═════════════════════════════════════════════════════════════════════════════
// UNIT TESTS — controller in isolation (no real DB)
// ═════════════════════════════════════════════════════════════════════════════

describe('Unit — createCommittee controller', () => {
  let createCommittee;
  let Committee;

  beforeAll(() => {
    // Isolate: mock the Committee model before requiring the controller
    jest.mock('../src/models/Committee');
    jest.mock('../src/services/auditService', () => ({
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    }));

    Committee = require('../src/models/Committee');
    ({ createCommittee } = require('../src/controllers/committeeController'));
  });

  afterAll(() => {
    jest.resetModules();
    jest.unmock('../src/models/Committee');
    jest.unmock('../src/services/auditService');
  });

  beforeEach(() => jest.clearAllMocks());

  // ── 1. Happy path ──────────────────────────────────────────────────────────

  it('201: creates committee and returns all required fields', async () => {
    Committee.findOne.mockResolvedValue(null); // no duplicate
    const savedDoc = {
      committeeId: 'cmt_abc123',
      committeeName: 'Spring 2026 Thesis',
      description: 'A test committee',
      coordinatorId: 'usr_coord_01',
      advisorIds: [],
      juryIds: [],
      status: 'draft',
      forwardedToAdvisorAssignment: true,
      createdAt: new Date().toISOString(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    Committee.mockImplementation(() => savedDoc);

    const req = makeReq({
      committeeName: 'Spring 2026 Thesis',
      coordinatorId: 'usr_coord_01',
      description: 'A test committee',
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.committeeId).toBe('cmt_abc123');
    expect(body.committeeName).toBe('Spring 2026 Thesis');
    expect(body.status).toBe('draft');
    expect(body.advisorIds).toEqual([]);
    expect(body.juryIds).toEqual([]);
    expect(body.createdAt).toBeDefined();
    expect(body.forwardedToAdvisorAssignment).toBe(true);
  });

  // ── 2. Role guard — 403 for non-coordinator ────────────────────────────────

  it('403: student role is rejected', async () => {
    const req = makeReq(
      { committeeName: 'X', coordinatorId: 'usr_student_01' },
      { userId: 'usr_student_01', role: 'student' }
    );
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('403: professor role is rejected', async () => {
    const req = makeReq(
      { committeeName: 'X', coordinatorId: 'usr_prof_01' },
      { userId: 'usr_prof_01', role: 'professor' }
    );
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403: coordinatorId in body does not match authenticated user', async () => {
    const req = makeReq({
      committeeName: 'X',
      coordinatorId: 'usr_other_coord', // mismatch
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'FORBIDDEN' });
  });

  // ── 3. Duplicate name — 409 ────────────────────────────────────────────────

  it('409: duplicate committeeName returns DUPLICATE_COMMITTEE_NAME', async () => {
    Committee.findOne.mockResolvedValue({ committeeId: 'cmt_existing' });

    const req = makeReq({
      committeeName: 'Existing Committee',
      coordinatorId: 'usr_coord_01',
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: 'DUPLICATE_COMMITTEE_NAME',
    });
  });

  it('409: duplicate check is case-insensitive (EXISTING vs existing)', async () => {
    // The regex query would match; simulate findOne returning a doc
    Committee.findOne.mockImplementation(async (query) => {
      const pattern = query.committeeName?.$regex;
      if (pattern && pattern.test('Existing Committee')) {
        return { committeeId: 'cmt_existing' };
      }
      return null;
    });

    const req = makeReq({
      committeeName: 'EXISTING COMMITTEE', // uppercase variant
      coordinatorId: 'usr_coord_01',
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  // ── 4. Input validation — 400 ──────────────────────────────────────────────

  it('400: missing committeeName', async () => {
    const req = makeReq({ coordinatorId: 'usr_coord_01' });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'MISSING_FIELDS' });
  });

  it('400: committeeName whitespace-only', async () => {
    const req = makeReq({ committeeName: '   ', coordinatorId: 'usr_coord_01' });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400: committeeName exceeds 100 characters', async () => {
    const req = makeReq({
      committeeName: 'A'.repeat(101),
      coordinatorId: 'usr_coord_01',
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('400: description exceeds 500 characters', async () => {
    Committee.findOne.mockResolvedValue(null);
    const req = makeReq({
      committeeName: 'Valid Name',
      coordinatorId: 'usr_coord_01',
      description: 'D'.repeat(501),
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('400: missing coordinatorId', async () => {
    const req = makeReq({ committeeName: 'Valid' });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS — real MongoDB (in-memory via env or local)
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration — createCommittee D3 write & f02 forwarding', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-committee-creation';

  let Committee;
  let createCommittee;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    Committee = require('../src/models/Committee');
    ({ createCommittee } = require('../src/controllers/committeeController'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Committee.deleteMany({});
  });

  // ── D3 write ───────────────────────────────────────────────────────────────

  it('D3: persists committee with status draft and empty arrays', async () => {
    const req = makeReq({
      committeeName: 'Alpha Committee',
      coordinatorId: 'usr_coord_01',
      description: 'Integration test committee',
    });
    const res = makeRes();

    await createCommittee(req, res);

    expect(res.status).toHaveBeenCalledWith(201);

    const saved = await Committee.findOne({ committeeName: 'Alpha Committee' });
    expect(saved).not.toBeNull();
    expect(saved.status).toBe('draft');
    expect(saved.advisorIds).toEqual([]);
    expect(saved.juryIds).toEqual([]);
    expect(saved.committeeId).toMatch(/^cmt_/);
    expect(saved.createdAt).toBeDefined();
  });

  // ── f02: forwarding flag ───────────────────────────────────────────────────

  it('f02: forwardedToAdvisorAssignment is true in D3 record', async () => {
    const req = makeReq({
      committeeName: 'Beta Committee',
      coordinatorId: 'usr_coord_01',
    });
    const res = makeRes();

    await createCommittee(req, res);

    const saved = await Committee.findOne({ committeeName: 'Beta Committee' });
    expect(saved.forwardedToAdvisorAssignment).toBe(true);

    // Also verified in the 201 response
    const body = res.json.mock.calls[0][0];
    expect(body.forwardedToAdvisorAssignment).toBe(true);
  });

  // ── Duplicate check (integration) ─────────────────────────────────────────

  it('409: second request with same name (exact) returns conflict', async () => {
    const body = { committeeName: 'Gamma Committee', coordinatorId: 'usr_coord_01' };

    await createCommittee(makeReq(body), makeRes()); // first — succeeds

    const res2 = makeRes();
    await createCommittee(makeReq(body), res2);       // second — conflict

    expect(res2.status).toHaveBeenCalledWith(409);
    expect(res2.json.mock.calls[0][0]).toMatchObject({
      code: 'DUPLICATE_COMMITTEE_NAME',
    });
  });

  it('409: duplicate check is case-insensitive (integration)', async () => {
    await createCommittee(
      makeReq({ committeeName: 'Delta Committee', coordinatorId: 'usr_coord_01' }),
      makeRes()
    );

    const res2 = makeRes();
    await createCommittee(
      makeReq({ committeeName: 'delta committee', coordinatorId: 'usr_coord_01' }),
      res2
    );

    expect(res2.status).toHaveBeenCalledWith(409);
  });

  // ── description optional ───────────────────────────────────────────────────

  it('201: committee without description stores null in D3', async () => {
    const req = makeReq({
      committeeName: 'Epsilon Committee',
      coordinatorId: 'usr_coord_01',
      // no description
    });
    const res = makeRes();

    await createCommittee(req, res);

    const saved = await Committee.findOne({ committeeName: 'Epsilon Committee' });
    expect(saved.description).toBeNull();
  });
});
