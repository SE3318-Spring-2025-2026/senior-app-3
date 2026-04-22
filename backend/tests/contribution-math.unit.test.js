'use strict';

jest.mock('../src/models/Group', () => ({
  findOne: jest.fn(),
}));
jest.mock('../src/models/SprintRecord', () => ({
  findOne: jest.fn(),
}));
jest.mock('../src/models/ContributionRecord', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../src/models/GitHubSyncJob', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../src/services/auditService', () => ({
  createAuditLog: jest.fn(),
}));
jest.mock('../src/utils/cryptoUtils', () => ({
  decrypt: jest.fn((value) => value),
}));
jest.mock('../src/models/ScheduleWindow', () => ({
  findOne: jest.fn(),
}));

const SprintRecord = require('../src/models/SprintRecord');
const ContributionRecord = require('../src/models/ContributionRecord');
const ScheduleWindow = require('../src/models/ScheduleWindow');
const Group = require('../src/models/Group');
const GitHubSyncJob = require('../src/models/GitHubSyncJob');

const {
  determineMergeStatus,
  getSprintIssues,
} = require('../src/services/githubSyncService');
const { updateContributionMetrics } = require('../src/services/d6UpdateService');
const { checkScheduleWindow } = require('../src/middleware/scheduleWindow');
const { triggerGitHubSync } = require('../src/controllers/githubSync');

describe('Contribution attribution + ratio math (unit)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Attribution state mapping', () => {
    it('maps merged and unmerged PR states deterministically', () => {
      expect(determineMergeStatus({ merged: true, merge_state: 'clean' })).toBe('MERGED');
      expect(determineMergeStatus({ merged: false, merged_at: new Date().toISOString() })).toBe('MERGED');
      expect(determineMergeStatus({ merged: false, merge_state: 'clean' })).toBe('NOT_MERGED');
      expect(determineMergeStatus({ merged: false, merge_state: 'blocked' })).toBe('NOT_MERGED');
      expect(determineMergeStatus({ merged: false, merge_state: 'new_state' })).toBe('UNKNOWN');
    });
  });

  describe('Unmapped GitHub users in sprint issues', () => {
    it('keeps contribution records even when only studentId exists', async () => {
      SprintRecord.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          sprintId: 'spr_1',
          groupId: 'grp_1',
          deliverableRefs: [],
        }),
      });
      ContributionRecord.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { sprintId: 'spr_1', groupId: 'grp_1', studentId: 'stu_unmapped' },
        ]),
      });

      const issues = await getSprintIssues('spr_1', 'grp_1');
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'spr_1-stu_unmapped',
            source: 'contribution_record',
            studentId: 'stu_unmapped',
          }),
        ])
      );
    });
  });

  describe('Contribution ratio safety', () => {
    it('calculates ratio for positive targets', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      ContributionRecord.findOne.mockResolvedValue({
        sprintId: 'spr_1',
        studentId: 'stu_1',
        groupId: 'grp_1',
        storyPointsAssigned: 10,
        storyPointsCompleted: 0,
        contributionRatio: 0,
        save,
      });

      const updated = await updateContributionMetrics('spr_1', 'stu_1', 'grp_1', {
        storyPointsCompleted: 7,
        prsMerged: 3,
      });

      expect(updated.contributionRatio).toBe(0.7);
      expect(updated.pullRequestsMerged).toBe(3);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('does not divide by zero when target is zero', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      ContributionRecord.findOne.mockResolvedValue({
        sprintId: 'spr_1',
        studentId: 'stu_2',
        groupId: 'grp_1',
        storyPointsAssigned: 0,
        storyPointsCompleted: 0,
        contributionRatio: 0,
        save,
      });

      const updated = await updateContributionMetrics('spr_1', 'stu_2', 'grp_1', {
        storyPointsCompleted: 5,
      });

      expect(updated.contributionRatio).toBe(0);
      expect(updated.storyPointsCompleted).toBe(5);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('throws safe domain error when contribution record is missing', async () => {
      ContributionRecord.findOne.mockResolvedValue(null);

      await expect(
        updateContributionMetrics('spr_missing', 'stu_missing', 'grp_missing', {
          storyPointsCompleted: 3,
        })
      ).rejects.toMatchObject({
        name: 'D6UpdateServiceError',
        code: 'CONTRIBUTION_NOT_FOUND',
      });
    });

    it.each([
      { assigned: 8, completed: 8, expected: 1 },
      { assigned: 5, completed: 2, expected: 0.4 },
      { assigned: 20, completed: 15, expected: 0.75 },
    ])(
      'matches golden ratio for assigned=$assigned completed=$completed',
      async ({ assigned, completed, expected }) => {
        const save = jest.fn().mockResolvedValue(undefined);
        ContributionRecord.findOne.mockResolvedValue({
          sprintId: 'spr_golden',
          studentId: 'stu_golden',
          groupId: 'grp_golden',
          storyPointsAssigned: assigned,
          storyPointsCompleted: 0,
          contributionRatio: 0,
          save,
        });

        const updated = await updateContributionMetrics('spr_golden', 'stu_golden', 'grp_golden', {
          storyPointsCompleted: completed,
        });

        expect(updated.contributionRatio).toBe(expected);
        expect(save).toHaveBeenCalledTimes(1);
      }
    );

    it('updates optional metrics fields when provided', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      ContributionRecord.findOne.mockResolvedValue({
        sprintId: 'spr_metrics',
        studentId: 'stu_metrics',
        groupId: 'grp_metrics',
        storyPointsAssigned: 4,
        storyPointsCompleted: 0,
        pullRequestsMerged: 0,
        issuesResolved: 0,
        commitsCount: 0,
        contributionRatio: 0,
        save,
      });

      const updated = await updateContributionMetrics('spr_metrics', 'stu_metrics', 'grp_metrics', {
        prsMerged: 2,
        issuesResolved: 6,
        commitsCount: 11,
        storyPointsCompleted: 3,
      });

      expect(updated.pullRequestsMerged).toBe(2);
      expect(updated.issuesResolved).toBe(6);
      expect(updated.commitsCount).toBe(11);
      expect(updated.contributionRatio).toBe(0.75);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('returns service error when persistence fails', async () => {
      const save = jest.fn().mockRejectedValue(new Error('db down'));
      ContributionRecord.findOne.mockResolvedValue({
        sprintId: 'spr_err',
        studentId: 'stu_err',
        groupId: 'grp_err',
        storyPointsAssigned: 10,
        storyPointsCompleted: 4,
        contributionRatio: 0.4,
        save,
      });

      await expect(
        updateContributionMetrics('spr_err', 'stu_err', 'grp_err', {
          storyPointsCompleted: 9,
        })
      ).rejects.toMatchObject({
        name: 'D6UpdateServiceError',
        code: 'CONTRIBUTION_UPDATE_FAILED',
      });
    });
  });
});

describe('Schedule/config boundary behavior (unit)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 422 WINDOW_CLOSED when advisor_association window is inactive', async () => {
    ScheduleWindow.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const middleware = checkScheduleWindow('advisor_association');
    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      code: 'WINDOW_CLOSED',
      message: 'Advisor association schedule is closed',
    });
  });

  it('returns 422 for unpublished configuration boundary via middleware override', async () => {
    ScheduleWindow.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const middleware = checkScheduleWindow('advisor_association', {
      statusCode: 422,
      message: 'Contribution configuration is unpublished',
    });
    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      code: 'WINDOW_CLOSED',
      message: 'Contribution configuration is unpublished',
    });
  });
});

describe('Locked sprint behavior (unit)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 409 when sync lock already exists for sprint', async () => {
    Group.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        groupId: 'grp_lock',
        githubPat: 'x',
        githubOrg: 'org',
        githubRepoName: 'repo',
      }),
    });
    SprintRecord.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ sprintId: 'spr_lock', groupId: 'grp_lock' }),
    });
    GitHubSyncJob.create.mockRejectedValue({ code: 11000 });
    GitHubSyncJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ jobId: 'job_locked_1' }),
    });

    const req = {
      params: { groupId: 'grp_lock', sprintId: 'spr_lock' },
      user: { userId: 'coord_1' },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await triggerGitHubSync(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'SYNC_ALREADY_RUNNING',
        job_id: 'job_locked_1',
      })
    );
  });
});
