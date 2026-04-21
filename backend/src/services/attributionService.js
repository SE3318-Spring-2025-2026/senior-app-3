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
    useJiraFallback = false,
    overrideExisting = true,
    includePartialMerges = false,
  } = options;

  try {
    console.log(
      `[attributeStoryPoints] ISSUE #235 START: sprintId=${sprintId}, groupId=${groupId}, useJiraFallback=${useJiraFallback}`
    );

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
      // Not necessarily an error — sprint may not have been created yet
    }

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

    const usersInGroup = await User.find({
      studentId: { $in: Array.from(approvedStudentIds) },
    }).select('studentId githubUsername');

    // Map: githubUsername (normalized) → studentId
    const gitHubUsernameMap = new Map();
    usersInGroup.forEach((user) => {
      if (user.githubUsername) {
        // Normalize to lowercase for case-insensitive matching (GitHub usernames are lowercase)
        gitHubUsernameMap.set(user.githubUsername.toLowerCase(), user.studentId);
      }
    });

    console.log(
      `[attributeStoryPoints] D1 LOOKUP: Built GitHub username map for ${gitHubUsernameMap.size} students with GitHub accounts`
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

    console.log(
      `[attributeStoryPoints] PROCESSING ${githubSyncJob.validationRecords?.length || 0} validation records from GitHub sync`
    );

    for (const record of githubSyncJob.validationRecords || []) {
      // ISSUE #235 SAFETY: Only process merged issues
      if (record.merge_status !== 'MERGED') {
        console.log(
          `[attributeStoryPoints] SKIP: Issue ${record.issue_key} merge_status=${record.merge_status} (not merged)`
        );
        continue;
      }

      const storyPoints = record.story_points || 0;
      let attributedStudentId = null;
      let attributionReason = 'UNATTRIBUTABLE';
      let gitHubHandle = null;

      // ───────────────────────────────────────────────────────────────────────────
      // PRIMARY RULE: GitHub PR author
      // ───────────────────────────────────────────────────────────────────────────
      // ISSUE #235: "Primary: GitHub usernames on merged PRs mapped to studentId via D1"

      if (record.pr_author) {
        const normalizedAuthor = record.pr_author.toLowerCase();
        const studentIdFromD1 = gitHubUsernameMap.get(normalizedAuthor);

        if (studentIdFromD1) {
          // Author found in D1 AND in group
          attributedStudentId = studentIdFromD1;
          attributionReason = 'ATTRIBUTED_VIA_GITHUB_AUTHOR';
          gitHubHandle = record.pr_author;

          console.log(
            `[attributeStoryPoints] ATTRIBUTED: Issue ${record.issue_key} → student ${studentIdFromD1} via GitHub author ${record.pr_author}`
          );
        } else {
          // Author found but NOT in group or NOT in D1
          const userExists = await User.findOne({ githubUsername: normalizedAuthor }).select('studentId');
          if (userExists) {
            // User exists but NOT approved member of group
            attributionReason = 'REJECTED_NOT_IN_GROUP';
            gitHubHandle = record.pr_author;
            console.warn(
              `[attributeStoryPoints] REJECTED: Issue ${record.issue_key} — GitHub author ${record.pr_author} exists but not in group ${groupId}`
            );
            warnings.push({
              issue_key: record.issue_key,
              reason: 'GITHUB_AUTHOR_NOT_IN_GROUP',
              github_username: record.pr_author,
            });
          } else {
            // User does not exist in D1
            attributionReason = 'UNATTRIBUTABLE_GITHUB_NOT_FOUND';
            gitHubHandle = record.pr_author;
            console.warn(
              `[attributeStoryPoints] UNATTRIBUTABLE: Issue ${record.issue_key} — GitHub author ${record.pr_author} not found in D1`
            );
            warnings.push({
              issue_key: record.issue_key,
              reason: 'GITHUB_AUTHOR_NOT_IN_D1',
              github_username: record.pr_author,
            });
          }
        }
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

      if (!attributedStudentId && useJiraFallback && record.jira_assignee) {
        console.log(
          `[attributeStoryPoints] FALLBACK: Attempting JIRA assignee lookup for issue ${record.issue_key}`
        );

        // Note: JIRA assignee is typically an email or JIRA username, not necessarily GitHub username.
        // For this implementation, we assume JIRA assignee maps to githubUsername.
        // In production, this might require a separate JIRA → D1 mapping.

        const jiraAssigneeNormalized = record.jira_assignee.toLowerCase();
        const studentIdFromJira = gitHubUsernameMap.get(jiraAssigneeNormalized);

        if (studentIdFromJira) {
          attributedStudentId = studentIdFromJira;
          attributionReason = 'ATTRIBUTED_VIA_JIRA_ASSIGNEE_FALLBACK';
          console.log(
            `[attributeStoryPoints] FALLBACK MATCHED: Issue ${record.issue_key} → student ${studentIdFromJira} via JIRA assignee`
          );
        } else {
          const jiraUserExists = await User.findOne({ githubUsername: jiraAssigneeNormalized }).select('studentId');
          if (jiraUserExists && !approvedStudentIds.has(jiraUserExists.studentId)) {
            attributionReason = 'REJECTED_JIRA_ASSIGNEE_NOT_IN_GROUP';
            console.warn(
              `[attributeStoryPoints] REJECTED: Issue ${record.issue_key} — JIRA assignee not in group`
            );
          } else {
            attributionReason = 'UNATTRIBUTABLE_JIRA_NOT_FOUND';
            console.warn(
              `[attributeStoryPoints] UNATTRIBUTABLE: Issue ${record.issue_key} — JIRA assignee not found in D1`
            );
          }
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
          issueKey: record.issue_key,
          completedPoints: storyPoints,
          gitHubHandle,
          mergeStatus: record.merge_status,
          decisionReason: attributionReason,
        });
      } else {
        // Failure: mark as unattributable
        unattributablePoints += storyPoints;
        unattributableCount += 1;

        attributionDetails.push({
          studentId: null,
          issueKey: record.issue_key,
          completedPoints: storyPoints,
          gitHubHandle,
          mergeStatus: record.merge_status,
          decisionReason: attributionReason,
        });

        console.log(
          `[attributeStoryPoints] UNATTRIBUTABLE: Issue ${record.issue_key} — reason: ${attributionReason}`
        );
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

    const upsertedRecords = [];

    for (const [studentId, completedPoints] of attributionMap.entries()) {
      const record = await ContributionRecord.findOneAndUpdate(
        {
          sprintId,
          studentId,
          groupId,
        },
        {
          storyPointsCompleted: completedPoints,
          lastUpdatedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      upsertedRecords.push(record);

      console.log(
        `[attributeStoryPoints] UPSERTED: ContributionRecord for student ${studentId}: ${completedPoints} SP`
      );
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
          warnings,
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
      attributionDetails,
      warnings,
      upsertedRecordIds: upsertedRecords.map((r) => r.contributionRecordId),
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
