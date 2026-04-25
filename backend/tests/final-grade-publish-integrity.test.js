const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Group = require('../src/models/Group');
const AuditLog = require('../src/models/AuditLog');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../src/models/FinalGrade');
const notificationService = require('../src/services/notificationService');
const {
  publishFinalGrades,
  FinalGradePublishError,
} = require('../src/services/finalGradePublishService');

describe('[ISSUE #262] Data Integrity & Atomic Publish Integration', () => {
  const coordinatorId = 'usr_coordinator';
  const groupId = 'grp_integrity_262';
  const publishCycle = '2025-FALL';
  let replset;
  let originalSetImmediate;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replset.getUri(), { dbName: 'issue262_integrity' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replset.stop();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    originalSetImmediate = global.setImmediate;
    global.setImmediate = (fn) => fn();

    await Group.create({
      groupId,
      groupName: `Issue 262 Group ${Date.now()}`,
      leaderId: 'student_leader',
      status: 'active',
      members: [{ userId: 'student_leader', role: 'leader', status: 'accepted' }],
    });
  });

  afterEach(async () => {
    global.setImmediate = originalSetImmediate;
    await FinalGrade.deleteMany({});
    await AuditLog.deleteMany({});
    await Group.deleteMany({});
  });

  const seedApprovedGrades = async ({ withOverride = false } = {}) => {
    const records = [
      {
        finalGradeId: `fg_262_a_${Date.now()}`,
        groupId,
        studentId: 'stu_262_1',
        publishCycle,
        baseGroupScore: 100,
        individualRatio: 0.75,
        computedFinalGrade: 75,
        status: FINAL_GRADE_STATUS.APPROVED,
        approvedBy: coordinatorId,
        approvedAt: new Date(),
        approvalComment: 'Approved for publish',
        overrideApplied: withOverride,
        overriddenFinalGrade: withOverride ? 85 : null,
        originalFinalGrade: withOverride ? 75 : null,
        overriddenBy: withOverride ? coordinatorId : null,
        overrideComment: withOverride ? 'Manual override for validated contribution' : null,
      },
      {
        finalGradeId: `fg_262_b_${Date.now()}`,
        groupId,
        studentId: 'stu_262_2',
        publishCycle,
        baseGroupScore: 100,
        individualRatio: 0.65,
        computedFinalGrade: 65,
        status: FINAL_GRADE_STATUS.APPROVED,
        approvedBy: coordinatorId,
        approvedAt: new Date(),
        approvalComment: 'Approved for publish',
      },
    ];

    await FinalGrade.insertMany(records);
  };

  const publishWithRetry = async (flags, maxAttempts = 3) => {
    let attempt = 0;
    let lastError = null;

    while (attempt < maxAttempts) {
      try {
        return await publishFinalGrades(groupId, publishCycle, coordinatorId, flags);
      } catch (error) {
        lastError = error;
        const isRetryable =
          error instanceof FinalGradePublishError &&
          error.statusCode === 500 &&
          error.errorCode === 'PUBLISH_FAILED';
        if (!isRetryable) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      attempt += 1;
    }

    throw lastError;
  };

  it('rolls back publish transaction when audit write fails', async () => {
    await seedApprovedGrades();

    jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('forced audit failure'));
    jest
      .spyOn(notificationService, 'dispatchBulkFinalGradeNotifications')
      .mockResolvedValue({ success: true });

    await expect(
      publishFinalGrades(groupId, publishCycle, coordinatorId, {
        email: true,
        sms: false,
        push: true,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'FinalGradePublishError',
        statusCode: 500,
      })
    );

    const publishedRows = await FinalGrade.countDocuments({
      groupId,
      publishCycle,
      status: FINAL_GRADE_STATUS.PUBLISHED,
    });
    const approvedRows = await FinalGrade.countDocuments({
      groupId,
      publishCycle,
      status: FINAL_GRADE_STATUS.APPROVED,
    });
    const publishLogs = await AuditLog.countDocuments({ action: 'FINAL_GRADE_PUBLISHED', groupId });

    expect(publishedRows).toBe(0);
    expect(approvedRows).toBe(2);
    expect(publishLogs).toBe(0);
  });

  it('rejects duplicate publish with 409 and preserves original publishedAt', async () => {
    await seedApprovedGrades();
    jest
      .spyOn(notificationService, 'dispatchBulkFinalGradeNotifications')
      .mockResolvedValue({ success: true });

    const firstResult = await publishWithRetry({
      email: true,
      sms: false,
      push: false,
    });

    const firstPublishedDoc = await FinalGrade.findOne({
      groupId,
      publishCycle,
      status: FINAL_GRADE_STATUS.PUBLISHED,
    }).sort({ publishedAt: 1 });

    await expect(
      publishFinalGrades(groupId, publishCycle, coordinatorId, {
        email: true,
        sms: false,
        push: false,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'FinalGradePublishError',
        statusCode: 409,
        errorCode: 'ALREADY_PUBLISHED',
      })
    );

    const currentDoc = await FinalGrade.findById(firstPublishedDoc._id);
    expect(firstResult.success).toBe(true);
    expect(currentDoc.publishedAt.toISOString()).toBe(firstPublishedDoc.publishedAt.toISOString());
  });

  it('persists override fidelity and coordinator traceability in published D7 rows', async () => {
    await seedApprovedGrades({ withOverride: true });
    jest
      .spyOn(notificationService, 'dispatchBulkFinalGradeNotifications')
      .mockResolvedValue({ success: true });

    await publishFinalGrades(groupId, publishCycle, coordinatorId, {
      email: true,
      sms: false,
      push: true,
    });

    const overriddenRow = await FinalGrade.findOne({
      groupId,
      studentId: 'stu_262_1',
      status: FINAL_GRADE_STATUS.PUBLISHED,
    });

    expect(overriddenRow).toBeTruthy();
    expect(overriddenRow.getEffectiveGrade()).toBe(85);
    expect(overriddenRow.originalFinalGrade).toBe(75);
    expect(overriddenRow.overriddenFinalGrade).toBe(85);
    expect(overriddenRow.overriddenBy).toBe(coordinatorId);
    expect(overriddenRow.publishedBy).toBe(coordinatorId);
  });

  it('dispatches notifications with exact groupId/publishCycle/flags payload', async () => {
    await seedApprovedGrades();

    const dispatchSpy = jest
      .spyOn(notificationService, 'dispatchBulkFinalGradeNotifications')
      .mockResolvedValue({ success: true });

    const notificationFlags = { email: true, sms: false, push: true };
    await publishFinalGrades(groupId, publishCycle, coordinatorId, notificationFlags);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(groupId, publishCycle, notificationFlags);
  });

  it('keeps published FinalGrade rows consistent with DFD/OpenAPI required fields', async () => {
    await seedApprovedGrades({ withOverride: true });
    jest
      .spyOn(notificationService, 'dispatchBulkFinalGradeNotifications')
      .mockResolvedValue({ success: true });

    await publishFinalGrades(groupId, publishCycle, coordinatorId, {
      email: true,
      sms: false,
      push: false,
    });

    const publishedRows = await FinalGrade.find({
      groupId,
      publishCycle,
      status: FINAL_GRADE_STATUS.PUBLISHED,
    });

    expect(publishedRows.length).toBe(2);
    for (const row of publishedRows) {
      expect(row.groupId).toBe(groupId);
      expect(row.publishCycle).toBe(publishCycle);
      expect(row.studentId).toBeTruthy();
      expect(row.status).toBe(FINAL_GRADE_STATUS.PUBLISHED);
      expect(row.publishedAt).toBeTruthy();
      expect(row.publishedBy).toBe(coordinatorId);
      expect(typeof row.computedFinalGrade).toBe('number');
      expect(typeof row.baseGroupScore).toBe('number');
      expect(typeof row.individualRatio).toBe('number');
    }
  });
});
