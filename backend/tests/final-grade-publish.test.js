jest.mock('../src/models/FinalGrade', () => ({
  FinalGrade: {
    find: jest.fn(),
    exists: jest.fn(),
    updateMany: jest.fn(),
    startSession: jest.fn(),
  },
  FINAL_GRADE_STATUS: {
    APPROVED: 'approved',
    PUBLISHED: 'published',
  },
}));

jest.mock('../src/models/AuditLog', () => ({
  create: jest.fn(),
}));

jest.mock('../src/services/notificationService', () => ({
  dispatchBulkFinalGradeNotifications: jest.fn().mockResolvedValue({ success: true }),
}));

const { FinalGrade } = require('../src/models/FinalGrade');
const AuditLog = require('../src/models/AuditLog');
const notificationService = require('../src/services/notificationService');
const {
  publishFinalGrades,
  FinalGradePublishError,
} = require('../src/services/finalGradePublishService');

describe('finalGradePublishService hardening', () => {
  let session;
  let originalSetImmediate;

  beforeEach(() => {
    jest.clearAllMocks();

    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };
    FinalGrade.startSession.mockResolvedValue(session);

    originalSetImmediate = global.setImmediate;
    global.setImmediate = (fn) => fn();
  });

  afterEach(() => {
    global.setImmediate = originalSetImmediate;
  });

  it('creates single aggregated audit log with affectedCount and dispatches notifications', async () => {
    FinalGrade.find.mockResolvedValue([
      { publishCycle: 'Fall2026' },
      { publishCycle: 'Fall2026' },
    ]);
    FinalGrade.exists.mockResolvedValue(false);
    FinalGrade.updateMany.mockResolvedValue({ modifiedCount: 2 });
    AuditLog.create.mockResolvedValue([{ _id: 'audit_1' }]);

    const result = await publishFinalGrades(
      'group-1',
      'Fall2026',
      'coord-1',
      { email: true, sms: false, push: true }
    );

    expect(FinalGrade.updateMany).toHaveBeenCalledWith(
      { groupId: 'group-1', publishCycle: 'Fall2026', status: 'approved' },
      {
        $set: expect.objectContaining({
          status: 'published',
          publishedBy: 'coord-1',
        }),
      },
      { session }
    );

    expect(AuditLog.create).toHaveBeenCalledTimes(1);
    expect(AuditLog.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: 'FINAL_GRADE_PUBLISHED',
          actorId: 'coord-1',
          groupId: 'group-1',
          payload: expect.objectContaining({
            publishCycle: 'Fall2026',
            affectedCount: 2,
            notificationFlags: { email: true, sms: false, push: true },
          }),
        }),
      ],
      { session }
    );

    expect(notificationService.dispatchBulkFinalGradeNotifications).toHaveBeenCalledWith(
      'group-1',
      'Fall2026',
      { email: true, sms: false, push: true }
    );
    expect(result.publishedCount).toBe(2);
  });

  it('throws 409 INCONSISTENT_CYCLE when provided cycle mismatches approved snapshot', async () => {
    FinalGrade.find.mockResolvedValue([{ publishCycle: 'Fall2026' }]);

    await expect(
      publishFinalGrades('group-1', 'Spring2027', 'coord-1', { email: true, sms: false, push: false })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'FinalGradePublishError',
        statusCode: 409,
        errorCode: 'INCONSISTENT_CYCLE',
      })
    );

    expect(FinalGrade.updateMany).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it('throws 422 when there is no approved snapshot', async () => {
    FinalGrade.find.mockResolvedValue([]);

    try {
      await publishFinalGrades('group-1', 'Fall2026', 'coord-1', { email: true, sms: false, push: false });
      throw new Error('Expected publishFinalGrades to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FinalGradePublishError);
      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('NO_APPROVED_GRADES');
    }
  });
});
