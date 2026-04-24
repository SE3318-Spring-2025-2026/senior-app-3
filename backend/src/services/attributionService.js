'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #235: ATTRIBUTION ENGINE — Map Story Points to Students
 * Process 7.3: Student Attribution from Merged Issues
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * Maps completed (merged) JIRA issues to individual students using:
 *   1. GitHub PR merge status (from Process 7.2)
 *   2. D1 identity linkage (githubUsername → studentId)
 *   3. D2 group membership validation (students in the group only)
 *   4. PR author/reviewer primary rule with JIRA assignee fallback
 *
 * Input Data Stores:
 *   - D6 (SprintRecord): Issue keys + PR merge status (written by githubSyncService)
 *   - D1 (User): githubUsername ↔ studentId mapping
 *   - D2 (GroupMembership): group → students (approved members only)
 *   - D6 (ContributionRecord): Story point totals per student per sprint
 *
 * Output:
 *   - Per-student completed story points in ContributionRecord
 *   - Unattributable points metrics (logged + surfaced in summary)
 *   - Deterministic mapping (same input = same output, idempotent)
 *
 * DFD Flows:
 *   f7_ds_d1_p73 (D1 → 7.3): GitHub username mapping
 *   f7_ds_d2_p73 (D2 → 7.3): Group membership validation
 *   f7_p72_p73 (7.2 → 7.3): Merged PR status from GitHub sync
 *   f7_p73_p74 (7.3 → 7.4): Attribution output → ratio engine
 *
 * Key Design Decisions:
 * 1. PRIMARY RULE: GitHub PR author → D1.githubUsername → studentId
 *    - PR author must exist in D1
 *    - PR author must be approved member of group (D2)
 *    - Only merged PRs contribute story points
 *
 * 2. FALLBACK RULE: JIRA issue assignee (if explicitly configured)
 *    - Not recommended for most projects
 *    - Only used if group.useJiraAssigneeForAttribution === true
 *    - Same D1 + D2 validation applies
 *
 * 3. CONFLICT RESOLUTION (edge case):
 *    - Multiple PR authors: Use FIRST author (deterministic)
 *    - PR author not in group: Mark as unattributable
 *    - GitHub match but not in D1: Log warning, mark unattributable
 *
 * 4. IDEMPOTENCY:
 *    - Safe to call multiple times on same (sprint, group)
 *    - Earlier run's ContributionRecords are overwritten (upsert semantics)
 *    - No duplicate accumulation
 *    - Same input always produces same output
 *
 * 5. SAFETY CONSTRAINTS:
 *    - Partial merges (opened but not merged) → NO story points
 *    - Draft PRs → NO story points (mapped to NOT_MERGED in githubSyncService)
 *    - Closed-but-unmerged → NO story points
 *    - Unknown merge status → Mark unattributable, log warning
 *
 * 6. AUDITABILITY:
 *    - Each attribution decision logged with:
 *      * issue_key, github_username, student_id
 *      * merge_status, group_id, sprint_id
 *      * decision (ATTRIBUTED | UNATTRIBUTABLE | REJECTED_NOT_IN_GROUP)
 *    - Unattributable reasons tracked separately (metrics)
 */

const User = require('../models/User');
const GroupMembership = require('../models/GroupMembership');
const ContributionRecord = require('../models/ContributionRecord');
const SprintRecord = require('../models/SprintRecord');
const GitHubSyncJob = require('../models/GitHubSyncJob');
const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');

// ═══════════════════════════════════════════════════════════════════════════════
// ATTRIBUTION SERVICE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AttributionServiceError — Custom error for attribution processing failures
 *
 * @param {number} status - HTTP status code
 * @param {string} code - Error code (e.g., 'NO_GITHUB_DATA', 'ATTRIBUTION_FAILED')
 * @param {string} message - Human-readable error message
 */
class AttributionServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AttributionServiceError';
    this.status = status;
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE ATTRIBUTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * attributeStoryPoints(sprintId, groupId, options)
 *
 * ISSUE #235 PRIMARY FUNCTION: Maps completed story points to students
 *
 * Process:
 * 1. Read GitHub sync results from D6 (merge status per issue)
 * 2. Read group membership from D2 (approved members only)
 * 3. For each merged issue:
 *    - Extract GitHub PR author/reviewer
 *    - Map to studentId via D1 (githubUsername)
 *    - Validate student is approved member of group (D2)
 *    - Accumulate story points for that student
 * 4. Create/update ContributionRecords in D6
 * 5. Return attribution summary with metrics
 *
 * @param {string} sprintId - Sprint ID (from D8 sprint configuration)
 * @param {string} groupId - Group ID (from D2 group membership)
 * @param {object} options - Attribution options
 *   - useJiraFallback: boolean (default: false) — use JIRA assignee if GitHub match fails
 *   - overrideExisting: boolean (default: true) — replace existing ContributionRecords
 *   - includePartialMerges: boolean (default: false) — include NOT_MERGED status
 *
 * @returns {Promise<object>} Attribution summary
 *   {
 *     sprintId: string,
 *     groupId: string,
 *     attributedStudents: number,
 *     totalStoryPoints: number,
 *     unattributablePoints: number,
 *     unattributableCount: number,
 *     attributionDetails: [
 *       { studentId, completedPoints, gitHubHandle, mergeStatus, decisionReason }
 *     ],
 *     warnings: [ { issue_key, reason, github_username } ]
 *   }
 *
 * @throws {AttributionServiceError} if D6/D2 data missing or invalid
 */
async function attributeStoryPoints(sprintId, groupId, options = {}) {
  const {
    enable_assignee_fallback = false,
    useJiraFallback = false,
    overrideExisting = true,
    includePartialMerges = false,
  } = options;

  try {
    console.log(`[attributeStoryPoints] ISSUE #235 START: sprintId=${sprintId}, groupId=${groupId}`);

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 1: VALIDATE GROUP & RETRIEVE GITHUB SYNC DATA (D6)
    // ═════════════════════════════════════════════════════════════════════════════
    // DFD Flow: f7_p72_p73 — Read GitHub merge status from D6
    //
    // Process 7.2 (githubSyncService) writes validation records to D6.
    // We read:
    //   1. SprintRecord (sprint + group context)
    //   2. GitHubSyncJob validation records (issue_key → merge_status)
    //
    // Issue: D6 SprintRecord includes deliverableRefs but not JIRA issues.
    // Assumption: Process 7.1 (JIRA sync) creates records in a separate structure.
    // For now, we assume GitHubSyncJob.validationRecords is the source of truth.

    const sprintRecord = await SprintRecord.findOne({ sprintId, groupId });
    if (!sprintRecord) {
      console.warn(`[attributeStoryPoints] No SprintRecord found for ${sprintId}/${groupId}`);
    }

    const group = await Group.findOne({ groupId }).select(
      'groupId enable_assignee_fallback useJiraAssigneeForAttribution'
    );
    const assigneeFallbackEnabled =
      enable_assignee_fallback === true ||
      useJiraFallback === true ||
      group?.enable_assignee_fallback === true ||
      group?.useJiraAssigneeForAttribution === true;

    // ISSUE #235 NOTE: GitHub sync job should exist; if not, no merged issues to attribute
    const githubSyncJob = await GitHubSyncJob.findOne({ sprintId, groupId }).sort({ createdAt: -1 });
    if (!githubSyncJob) {
      console.warn(
        `[attributeStoryPoints] No GitHub sync job found for ${sprintId}/${groupId} — no merge data available`
      );
      return {
        sprintId,
        groupId,
        attributedStudents: 0,
        totalStoryPoints: 0,
        unattributablePoints: 0,
        unattributableCount: 0,
        attributionDetails: [],
        warnings: [{ reason: 'NO_GITHUB_SYNC_DATA', message: 'GitHub sync has not been run for this sprint' }],
      };
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 2: READ GROUP MEMBERSHIP (D2)
    // ═════════════════════════════════════════════════════════════════════════════
    // DFD Flow: f7_ds_d2_p73 — Validate group membership
    //
    // Rule: Only approved members of the group can receive attribution.
    // ISSUE #235 ACCEPTANCE CRITERIA:
    //   "Students not in the group cannot receive attribution for the group's sprint"
    //
    // We fetch all APPROVED members of the group.
    // Students with status='pending' or 'rejected' are excluded.

    const groupMembers = await GroupMembership.find({
      groupId,
      status: 'approved', // ← Only approved members
    }).select('studentId');

    const approvedStudentIds = new Set(groupMembers.map((m) => m.studentId));
    console.log(
      `[attributeStoryPoints] D2 LOOKUP: Found ${approvedStudentIds.size} approved members in group ${groupId}`
    );

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 3: RETRIEVE D1 GITHUB USERNAME MAPPING
    // ═════════════════════════════════════════════════════════════════════════════
    // DFD Flow: f7_ds_d1_p73 — Map GitHub username to student ID
    //
    // PRIMARY RULE: GitHub PR author/reviewer → D1.githubUsername → studentId
    //
    // We build a reverse index: githubUsername → studentId
    // This allows fast lookup when we encounter a GitHub username in PR metadata.
    //
    // ISSUE #235 NOTE: We only index users in the group (optimization),
    // but we also check non-group members and mark them unattributable.

    const validationRecords = githubSyncJob.validationRecords || [];
    const candidateHandles = new Set();
    for (const record of validationRecords) {
      const prAuthor = record.prAuthor || record.pr_author || null;
      const jiraAssignee = record.jiraAssignee || record.jira_assignee || null;
      if (prAuthor) candidateHandles.add(prAuthor.toLowerCase());
      if (jiraAssignee) candidateHandles.add(jiraAssignee.toLowerCase());
    }

    const usersByHandle = new Map();
    if (candidateHandles.size > 0) {
      const users = await User.find({
        githubUsername: { $in: Array.from(candidateHandles) },
      }).select('studentId githubUsername');

      for (const user of users) {
        if (user.githubUsername) {
          usersByHandle.set(user.githubUsername.toLowerCase(), {
            studentId: user.studentId,
            inGroup: approvedStudentIds.has(user.studentId),
          });
        }
      }
    }

    console.log(
      `[attributeStoryPoints] D1 LOOKUP: indexed ${usersByHandle.size} users for ${candidateHandles.size} handles`
    );

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 4: PROCESS GITHUB SYNC VALIDATION RECORDS
    // ═════════════════════════════════════════════════════════════════════════════
    // ISSUE #235 CORE LOGIC: For each merged PR, attribute story points to the student
    //
    // GITHUB SYNC JOB STRUCTURE:
    // githubSyncJob.validationRecords = [
    //   {
    //     issue_key: "PROJ-123",
    //     pr_id: 456,
    //     pr_author: "john-doe",         // ← GitHub username
    //     pr_reviewers: ["jane-smith"],  // ← GitHub usernames
    //     merge_status: "MERGED" | "NOT_MERGED" | "UNKNOWN",
    //     story_points: 5,               // ← From JIRA sync (Process 7.1)
    //     jira_assignee: "jira-user",    // ← Optional, for fallback
    //     merged_at: timestamp or null,
    //   }
    // ]
    //
    // ATTRIBUTION DECISION TREE:
    // 1. merge_status !== "MERGED" → skip (no points for unmerged)
    // 2. pr_author exists AND in D1 → attribute to author
    //    - If author in group (D2) → ADD story_points to studentId
    //    - If author NOT in group → mark unattributable (REJECTED_NOT_IN_GROUP)
    // 3. If pr_author missing/not found AND useJiraFallback:
    //    - Try jira_assignee → same D1 + D2 lookup
    // 4. If no match found → mark unattributable (NO_MAPPING)

    const attributionMap = new Map(); // studentId → accumulated story points
    const attributionDetails = [];
    let totalStoryPoints = 0;
    let unattributablePoints = 0;
    let unattributableCount = 0;
    const warnings = [];

    const unattributableDetails = [];

    console.log(`[attributeStoryPoints] PROCESSING ${validationRecords.length} validation records from GitHub sync`);

    for (const record of validationRecords) {
      const issueKey = record.issueKey || record.issue_key || null;
      const prId = record.prId || record.pr_id || null;
      const prUrl = record.prUrl || record.pr_url || null;
      const prAuthor = record.prAuthor || record.pr_author || null;
      const jiraAssignee = record.jiraAssignee || record.jira_assignee || null;
      const mergeStatus = record.mergeStatus || record.merge_status || 'UNKNOWN';
      const storyPoints = record.storyPoints || record.story_points || 0;
      const prReviewers = Array.isArray(record.prReviewers || record.pr_reviewers)
        ? record.prReviewers || record.pr_reviewers
        : [];

      // ISSUE #235 SAFETY: Only process merged issues
      if (mergeStatus !== 'MERGED') {
        console.log(`[attributeStoryPoints] SKIP: Issue ${issueKey} mergeStatus=${mergeStatus} (not merged)`);
        continue;
      }

      let attributedStudentId = null;
      let attributionReason = 'UNATTRIBUTABLE';
      let githubHandle = null;
      let status = 'UNATTRIBUTABLE';

      // ───────────────────────────────────────────────────────────────────────────
      // PRIMARY RULE: GitHub PR author
      // ───────────────────────────────────────────────────────────────────────────
      // ISSUE #235: "Primary: GitHub usernames on merged PRs mapped to studentId via D1"

      if (prAuthor) {
        const normalizedAuthor = prAuthor.toLowerCase();
        const resolvedAuthor = usersByHandle.get(normalizedAuthor);

        if (!resolvedAuthor) {
          attributionReason = 'GITHUB_USER_NOT_FOUND_IN_D1';
          githubHandle = prAuthor;
          status = 'UNMAPPED';
        } else if (!resolvedAuthor.inGroup) {
          attributionReason = 'STUDENT_NOT_IN_GROUP_D2';
          githubHandle = prAuthor;
          status = 'UNATTRIBUTABLE';
        } else {
          attributedStudentId = resolvedAuthor.studentId;
          attributionReason = 'ATTRIBUTED_VIA_GITHUB_AUTHOR';
          githubHandle = prAuthor;
          status = 'ATTRIBUTED';
        }
      } else {
        attributionReason = 'MISSING_PR_AUTHOR';
        status = 'UNMAPPED';
      }

      // ───────────────────────────────────────────────────────────────────────────
      // FALLBACK RULE: JIRA assignee (if enabled)
      // ───────────────────────────────────────────────────────────────────────────
      // ISSUE #235: "Fallback: JIRA assignee if explicitly configured"
      //
      // Only used if:
      //   1. Primary GitHub author attribution failed
      //   2. Group has useJiraAssigneeForAttribution === true
      //   3. JIRA assignee is present

      if (!attributedStudentId && assigneeFallbackEnabled && jiraAssignee) {
        const jiraAssigneeNormalized = jiraAssignee.toLowerCase();
        const resolvedAssignee = usersByHandle.get(jiraAssigneeNormalized);

        if (!resolvedAssignee) {
          attributionReason = 'JIRA_ASSIGNEE_NOT_FOUND_IN_D1';
          status = 'UNMAPPED';
        } else if (!resolvedAssignee.inGroup) {
          attributionReason = 'JIRA_ASSIGNEE_NOT_IN_GROUP_D2';
          status = 'UNATTRIBUTABLE';
        } else {
          attributedStudentId = resolvedAssignee.studentId;
          attributionReason = 'ATTRIBUTED_VIA_JIRA_ASSIGNEE_FALLBACK';
          githubHandle = jiraAssignee;
          status = 'ATTRIBUTED';
        }
      }

      // ───────────────────────────────────────────────────────────────────────────
      // ACCUMULATE STORY POINTS
      // ───────────────────────────────────────────────────────────────────────────

      if (attributedStudentId) {
        // Success: add story points to student
        const current = attributionMap.get(attributedStudentId) || 0;
        attributionMap.set(attributedStudentId, current + storyPoints);
        totalStoryPoints += storyPoints;

        attributionDetails.push({
          studentId: attributedStudentId,
          issueKey,
          completedPoints: storyPoints,
          githubHandle,
          mergeStatus,
          prIdentifier: prUrl || prId,
          prReviewers,
          decisionReason: attributionReason,
        });
      } else {
        // Failure: mark as unattributable
        unattributablePoints += storyPoints;
        unattributableCount += 1;

        attributionDetails.push({
          studentId: null,
          issueKey,
          completedPoints: storyPoints,
          githubHandle,
          mergeStatus,
          prIdentifier: prUrl || prId,
          prReviewers,
          decisionReason: attributionReason,
          status,
        });

        unattributableDetails.push({
          issueKey,
          prIdentifier: prUrl || prId,
          reason: attributionReason,
          status,
        });

        warnings.push({
          issueKey,
          reason: attributionReason,
          githubUsername: githubHandle,
          status,
        });

        console.log(`[attributeStoryPoints] UNATTRIBUTABLE: Issue ${issueKey} — reason: ${attributionReason}`);
      }
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 5: PERSIST TO D6 (ContributionRecords)
    // ═════════════════════════════════════════════════════════════════════════════
    // ISSUE #235 IDEMPOTENCY: Upsert ContributionRecords per (sprint, student, group)
    //
    // Each attributed student gets a ContributionRecord with storyPointsCompleted.
    // If record already exists (from previous run), it is overwritten (idempotent).
    //
    // CONSTRAINT: Only create records for attributed students (not for unattributable).

    const now = new Date();
    const existingRecords = await ContributionRecord.find({ sprintId, groupId }).select('studentId');
    const existingStudentIds = new Set(existingRecords.map((record) => record.studentId));
    const finalStudentIds = new Set(attributionMap.keys());

    const bulkOps = [];

    for (const [studentId, completedPoints] of attributionMap.entries()) {
      bulkOps.push({
        updateOne: {
          filter: { sprintId, studentId, groupId },
          update: {
            $set: {
              storyPointsCompleted: completedPoints,
              lastUpdatedAt: now,
            },
          },
          upsert: true,
        },
      });
    }

    for (const studentId of existingStudentIds) {
      if (!finalStudentIds.has(studentId)) {
        bulkOps.push({
          updateOne: {
            filter: { sprintId, studentId, groupId },
            update: {
              $set: {
                storyPointsCompleted: 0,
                lastUpdatedAt: now,
              },
            },
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await ContributionRecord.bulkWrite(bulkOps, { ordered: false });
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 6: AUDIT LOGGING
    // ═════════════════════════════════════════════════════════════════════════════
    // ISSUE #235 AUDITABILITY: Log attribution decisions

    try {
      await createAuditLog({
        action: 'STORY_POINTS_ATTRIBUTED',
        actorId: 'system', // Process 7.3 is system-driven
        targetId: sprintId,
        groupId,
        payload: {
          sprintId,
          groupId,
          attributedStudents: attributionMap.size,
          totalStoryPoints,
          unattributablePoints,
          unattributableCount,
          unattributableDetails,
          warnings,
          assigneeFallbackEnabled,
        },
      });
    } catch (auditErr) {
      console.error('[attributeStoryPoints] Audit log failed (non-fatal):', auditErr.message);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // STEP 7: RETURN SUMMARY
    // ═════════════════════════════════════════════════════════════════════════════
    // ISSUE #235 OUTPUT: Attribution summary for ratio engine (Process 7.4)
    //
    // Output includes:
    //   - Per-student completed story points (ready for ratio calculation)
    //   - Unattributable metrics (for operational dashboards)
    //   - Warnings (for logging/debugging)
    //   - Deterministic output (idempotent)

    const summary = {
      sprintId,
      groupId,
      attributedStudents: attributionMap.size,
      totalStoryPoints,
      unattributablePoints,
      unattributableCount,
      unattributableDetails,
      attributionDetails,
      warnings,
      assigneeFallbackEnabled,
    };

    console.log(
      `[attributeStoryPoints] ISSUE #235 COMPLETE: ${summary.attributedStudents} students attributed, ${summary.unattributableCount} issues unattributable`
    );

    return summary;
  } catch (err) {
    console.error('[attributeStoryPoints] FATAL ERROR:', err);
    if (err instanceof AttributionServiceError) throw err;
    throw new AttributionServiceError(
      500,
      'ATTRIBUTION_FAILED',
      `Failed to map story points to students: ${err.message}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY: Map GitHub username to student ID (D1 lookup)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * mapGitHubToStudent(githubUsername, groupId)
 *
 * ISSUE #235 HELPER: Resolve GitHub username to studentId via D1 + D2
 *
 * Returns null if:
 *   - GitHub username not found in D1
 *   - User exists but not approved member of group
 *
 * Deterministic: Same username + groupId always returns same result.
 *
 * @param {string} githubUsername - GitHub username (case-insensitive)
 * @param {string} groupId - Group ID for membership check
 * @returns {Promise<string|null>} studentId or null if not found/not in group
 */
async function mapGitHubToStudent(githubUsername, groupId) {
  try {
    if (!githubUsername) return null;

    // Normalize to lowercase (GitHub usernames are lowercase)
    const normalized = githubUsername.toLowerCase();

    // Step 1: Find user by GitHub username (D1)
    const user = await User.findOne({ githubUsername: normalized }).select('studentId');
    if (!user) {
      console.log(
        `[mapGitHubToStudent] GitHub username ${githubUsername} not found in D1 (User collection)`
      );
      return null;
    }

    // Step 2: Check group membership (D2)
    const membership = await GroupMembership.findOne({
      groupId,
      studentId: user.studentId,
      status: 'approved',
    });

    if (!membership) {
      console.log(
        `[mapGitHubToStudent] User ${user.studentId} not approved member of group ${groupId}`
      );
      return null;
    }

    console.log(`[mapGitHubToStudent] Mapped ${githubUsername} → ${user.studentId} in group ${groupId}`);
    return user.studentId;
  } catch (err) {
    console.error('[mapGitHubToStudent] Error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY: Get attribution summary for a sprint
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getAttributionSummary(sprintId, groupId)
 *
 * ISSUE #235 QUERY: Retrieve existing attribution results for dashboard/display
 *
 * Returns per-student contribution totals from D6 (ContributionRecords).
 *
 * @param {string} sprintId - Sprint ID
 * @param {string} groupId - Group ID
 * @returns {Promise<object>} { students: [{ studentId, completedPoints }], total: number }
 */
async function getAttributionSummary(sprintId, groupId) {
  try {
    const records = await ContributionRecord.find({ sprintId, groupId }).select(
      'studentId storyPointsCompleted'
    );

    const total = records.reduce((sum, r) => sum + (r.storyPointsCompleted || 0), 0);

    return {
      sprintId,
      groupId,
      students: records.map((r) => ({
        studentId: r.studentId,
        completedPoints: r.storyPointsCompleted || 0,
      })),
      total,
    };
  } catch (err) {
    console.error('[getAttributionSummary] Error:', err.message);
    throw new AttributionServiceError(
      500,
      'SUMMARY_FAILED',
      `Failed to retrieve attribution summary: ${err.message}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  attributeStoryPoints,
  mapGitHubToStudent,
  getAttributionSummary,
  AttributionServiceError,
};
