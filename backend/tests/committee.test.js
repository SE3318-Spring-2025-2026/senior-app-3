/**
 * Committee Assignment Tests
 *
 * Covers addJuryMembers controller behavior for Issue #73.
 */

const mongoose = require('mongoose');

describe('Committee controller - addJuryMembers', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-committees';

  let Committee;
  let User;
  let addJuryMembers;

  const makeReq = (params = {}, body = {}, user = { userId: 'usr_coordinator', role: 'coordinator' }) => ({
    params,
    body,
    user,
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createUser = (overrides = {}) =>
    User.create({
      email: `test_${Date.now()}_${Math.random()}@example.com`,
      hashedPassword: 'hashed',
      userId: overrides.userId || `usr_${Date.now()}`,
      role: overrides.role || 'professor',
      accountStatus: 'active',
      ...overrides,
    });

  const createCommittee = (overrides = {}) =>
    Committee.create({
      committeeName: `Committee ${Date.now()}-${Math.random()}`,
      coordinatorId: 'usr_coordinator',
      advisorIds: [],
      juryIds: [],
      status: 'draft',
      ...overrides,
    });

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);

    Committee = require('../src/models/Committee');
    User = require('../src/models/User');
    ({ addJuryMembers } = require('../src/controllers/committees'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([Committee.deleteMany({}), User.deleteMany({})]);
    jest.clearAllMocks();
  });

  it('adds jury members to a draft committee', async () => {
    const coordinator = await createUser({ userId: 'usr_coordinator', role: 'coordinator' });
    const professor = await createUser({ userId: 'usr_professor1', role: 'professor' });
    const committee = await createCommittee({ coordinatorId: coordinator.userId });

    const req = makeReq({ committeeId: committee.committeeId }, { juryIds: [professor.userId] }, coordinator);
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.juryIds).toContain(professor.userId);
    expect(body.juryIds.length).toBe(1);
  });

  it('returns 400 when juryIds is missing or empty', async () => {
    const committee = await createCommittee();
    const req = makeReq({ committeeId: committee.committeeId }, { juryIds: [] });
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_INPUT');
  });

  it('returns 404 when the committee does not exist', async () => {
    const req = makeReq({ committeeId: 'nonexistent' }, { juryIds: ['usr_professor1'] });
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('COMMITTEE_NOT_FOUND');
  });

  it('returns 409 when the committee is already published', async () => {
    const professor = await createUser({ userId: 'usr_professor2', role: 'professor' });
    const committee = await createCommittee({ status: 'published' });

    const req = makeReq({ committeeId: committee.committeeId }, { juryIds: [professor.userId] });
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('COMMITTEE_ALREADY_PUBLISHED');
  });

  it('returns 400 when a jury member user does not exist', async () => {
    const committee = await createCommittee();
    const req = makeReq({ committeeId: committee.committeeId }, { juryIds: ['usr_missing'] });
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('JURY_MEMBER_NOT_FOUND');
  });

  it('returns 400 when a jury member has an invalid role', async () => {
    const student = await createUser({ userId: 'usr_student', role: 'student' });
    const committee = await createCommittee();

    const req = makeReq({ committeeId: committee.committeeId }, { juryIds: [student.userId] });
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_JURY_MEMBER_ROLE');
  });

  it('returns 409 when a jury member is already assigned as advisor', async () => {
    const professor = await createUser({ userId: 'usr_professor3', role: 'professor' });
    const committee = await createCommittee({ advisorIds: [professor.userId] });

    const req = makeReq({ committeeId: committee.committeeId }, { juryIds: [professor.userId] });
    const res = makeRes();

    await addJuryMembers(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('JURY_ADVISOR_CONFLICT');
  });
});
