'use strict';

const { evaluateAttributionRecords } = require('../src/services/attributionService');

describe('Issue #247 - pure attribution evaluation', () => {
  function buildUsersByHandle() {
    return new Map([
      ['john-doe', { studentId: 'student-1', inGroup: true }],
      ['jane-doe', { studentId: 'student-2', inGroup: true }],
      ['outsider', { studentId: 'student-9', inGroup: false }],
      ['jira-fallback', { studentId: 'student-3', inGroup: true }],
    ]);
  }

  test('attributes merged issues to mapped in-group authors and skips unmerged ones', () => {
    const result = evaluateAttributionRecords(
      [
        { issueKey: 'PROJ-1', prId: '11', prAuthor: 'john-doe', mergeStatus: 'MERGED', storyPoints: 5 },
        { issueKey: 'PROJ-2', prId: '12', prAuthor: 'john-doe', mergeStatus: 'NOT_MERGED', storyPoints: 8 },
        { issueKey: 'PROJ-3', prId: '13', prAuthor: 'john-doe', mergeStatus: 'UNKNOWN', storyPoints: 3 },
      ],
      buildUsersByHandle(),
      { approvedStudentIds: new Set(['student-1', 'student-2', 'student-3']) }
    );

    expect(result.totalStoryPoints).toBe(5);
    expect(result.unattributableCount).toBe(0);
    expect(result.attributionMap.get('student-1')).toBe(5);
    expect(result.attributionDetails).toEqual([
      expect.objectContaining({
        issueKey: 'PROJ-1',
        studentId: 'student-1',
        completedPoints: 5,
        decisionReason: 'ATTRIBUTED_VIA_GITHUB_AUTHOR',
      }),
    ]);
  });

  test('marks unmapped GitHub users as unattributable with identifiers', () => {
    const result = evaluateAttributionRecords(
      [
        {
          issueKey: 'PROJ-4',
          prId: '14',
          prUrl: 'https://example.test/pr/14',
          prAuthor: 'ghost-user',
          mergeStatus: 'MERGED',
          storyPoints: 4,
        },
      ],
      buildUsersByHandle(),
      { approvedStudentIds: new Set(['student-1', 'student-2', 'student-3']) }
    );

    expect(result.totalStoryPoints).toBe(0);
    expect(result.unattributablePoints).toBe(4);
    expect(result.unattributableCount).toBe(1);
    expect(result.attributionDetails[0]).toEqual(
      expect.objectContaining({
        issueKey: 'PROJ-4',
        studentId: null,
        decisionReason: 'GITHUB_USER_NOT_FOUND_IN_D1',
        prIdentifier: 'https://example.test/pr/14',
        status: 'UNMAPPED',
      })
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({
        issueKey: 'PROJ-4',
        reason: 'GITHUB_USER_NOT_FOUND_IN_D1',
        githubUsername: 'ghost-user',
        status: 'UNMAPPED',
      }),
    ]);
  });

  test('marks mapped but out-of-group users as unattributable', () => {
    const result = evaluateAttributionRecords(
      [{ issueKey: 'PROJ-5', prId: '15', prAuthor: 'outsider', mergeStatus: 'MERGED', storyPoints: 6 }],
      buildUsersByHandle(),
      { approvedStudentIds: new Set(['student-1', 'student-2', 'student-3']) }
    );

    expect(result.totalStoryPoints).toBe(0);
    expect(result.unattributablePoints).toBe(6);
    expect(result.attributionDetails[0]).toEqual(
      expect.objectContaining({
        issueKey: 'PROJ-5',
        decisionReason: 'STUDENT_NOT_IN_GROUP_D2',
        status: 'UNATTRIBUTABLE',
      })
    );
  });

  test('uses JIRA assignee fallback only when enabled', () => {
    const record = {
      issueKey: 'PROJ-6',
      prId: '16',
      prAuthor: 'missing-author',
      jiraAssignee: 'jira-fallback',
      mergeStatus: 'MERGED',
      storyPoints: 7,
    };

    const disabled = evaluateAttributionRecords([record], buildUsersByHandle(), {
      approvedStudentIds: new Set(['student-1', 'student-2', 'student-3']),
      assigneeFallbackEnabled: false,
    });
    expect(disabled.totalStoryPoints).toBe(0);
    expect(disabled.unattributableCount).toBe(1);
    expect(disabled.attributionDetails[0].decisionReason).toBe('GITHUB_USER_NOT_FOUND_IN_D1');

    const enabled = evaluateAttributionRecords([record], buildUsersByHandle(), {
      approvedStudentIds: new Set(['student-1', 'student-2', 'student-3']),
      assigneeFallbackEnabled: true,
    });
    expect(enabled.totalStoryPoints).toBe(7);
    expect(enabled.unattributableCount).toBe(0);
    expect(enabled.attributionMap.get('student-3')).toBe(7);
    expect(enabled.attributionDetails[0].decisionReason).toBe('ATTRIBUTED_VIA_JIRA_ASSIGNEE_FALLBACK');
  });

  test('returns deterministic golden output for a mixed batch', () => {
    const input = [
      { issueKey: 'PROJ-10', prId: '21', prAuthor: 'john-doe', mergeStatus: 'MERGED', storyPoints: 5 },
      { issueKey: 'PROJ-11', prId: '22', prAuthor: 'jane-doe', mergeStatus: 'MERGED', storyPoints: 8 },
      { issueKey: 'PROJ-12', prId: '23', prAuthor: 'ghost-user', mergeStatus: 'MERGED', storyPoints: 3 },
      { issueKey: 'PROJ-13', prId: '24', prAuthor: 'outsider', mergeStatus: 'MERGED', storyPoints: 2 },
      { issueKey: 'PROJ-14', prId: '25', prAuthor: 'john-doe', mergeStatus: 'NOT_MERGED', storyPoints: 13 },
    ];
    const options = { approvedStudentIds: new Set(['student-1', 'student-2', 'student-3']) };

    const first = evaluateAttributionRecords(input, buildUsersByHandle(), options);
    const second = evaluateAttributionRecords(input, buildUsersByHandle(), options);

    expect(Array.from(first.attributionMap.entries())).toEqual([
      ['student-1', 5],
      ['student-2', 8],
    ]);
    expect(first.totalStoryPoints).toBe(13);
    expect(first.unattributablePoints).toBe(5);
    expect(first.unattributableCount).toBe(2);
    expect(first.attributionDetails.map(item => item.issueKey)).toEqual(['PROJ-10', 'PROJ-11', 'PROJ-12', 'PROJ-13']);
    expect(Array.from(second.attributionMap.entries())).toEqual(Array.from(first.attributionMap.entries()));
    expect(second.attributionDetails).toEqual(first.attributionDetails);
    expect(second.warnings).toEqual(first.warnings);
  });
});
