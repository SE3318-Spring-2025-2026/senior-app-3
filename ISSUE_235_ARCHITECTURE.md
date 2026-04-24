# Issue #235 Integration Guide & Architecture Diagram

## High-Level Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PROCESS 7.2: GitHub Sync (Complete → 7.1)                              │
│ ═══════════════════════════════════════════════════════════════════════ │
│ Input: GitHub PR merge status, PR author, reviewers                     │
│ Output: D6 GitHubSyncJob.validationRecords with:                        │
│   - issue_key (PROJ-123)                                                │
│   - pr_author (john-doe)           ← ADDED by ISSUE #235                │
│   - merge_status (MERGED/NOT_MERGED)                                    │
│   - storyPoints (5)                ← ADDED by ISSUE #235                │
│   - jiraAssignee (optional)        ← ADDED by ISSUE #235                │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PROCESS 7.3: Story Point Attribution (Issue #235) ⭐                    │
│ ═══════════════════════════════════════════════════════════════════════ │
│                                                                         │
│  ┌─ STEP 1 ──────────────────────────────────────────────────────┐    │
│  │ Read: D6 GitHubSyncJob.validationRecords (from 7.2)          │    │
│  │ Filter: merge_status === 'MERGED' only                       │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                           ▼                                             │
│  ┌─ STEP 2 ──────────────────────────────────────────────────────┐    │
│  │ Read: D2 GroupMembership where status='approved'             │    │
│  │ Build: Set of approvedStudentIds for this group              │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                           ▼                                             │
│  ┌─ STEP 3 ──────────────────────────────────────────────────────┐    │
│  │ Read: D1 User records for approved students                  │    │
│  │ Build: gitHubUsernameMap[username] = studentId (normalized)  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                           ▼                                             │
│  ┌─ STEP 4: Attribution Decision Tree ───────────────────────────┐    │
│  │                                                               │    │
│  │  FOR EACH merged issue in validationRecords:                 │    │
│  │                                                               │    │
│  │  PRIMARY RULE:                                               │    │
│  │  ┌─ Read: pr_author (GitHub username)                       │    │
│  │  ├─ Lookup: D1 gitHubUsernameMap[pr_author]                │    │
│  │  ├─ If found → Get studentId                               │    │
│  │  │   ├─ Check: D2 approvedStudentIds.has(studentId)?       │    │
│  │  │   ├─ If YES → ATTRIBUTED_VIA_GITHUB_AUTHOR ✓            │    │
│  │  │   └─ If NO → REJECTED_NOT_IN_GROUP                      │    │
│  │  │   └─ Accumulate: attributionMap[studentId] += storyPoints│    │
│  │  └─ If NOT found → UNATTRIBUTABLE_GITHUB_NOT_FOUND         │    │
│  │  │   └─ Log warning                                         │    │
│  │  │                                                           │    │
│  │  FALLBACK RULE (if useJiraFallback enabled):               │    │
│  │  └─ If primary failed AND jiraAssignee exists              │    │
│  │     └─ Same D1+D2 lookup on jiraAssignee                   │    │
│  │     └─ If found → ATTRIBUTED_VIA_JIRA_ASSIGNEE_FALLBACK    │    │
│  │                                                               │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                           ▼                                             │
│  ┌─ STEP 5 ──────────────────────────────────────────────────────┐    │
│  │ Write: D6 ContributionRecord (idempotent upsert)            │    │
│  │ For each (sprintId, studentId, groupId):                    │    │
│  │   - storyPointsCompleted = accumulated points               │    │
│  │ Ensure: Same input = same output (no duplication)           │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                           ▼                                             │
│  ┌─ STEP 6 ──────────────────────────────────────────────────────┐    │
│  │ Audit Log:                                                  │    │
│  │ - action: 'STORY_POINTS_ATTRIBUTED'                         │    │
│  │ - actor: 'system'                                           │    │
│  │ - target: sprintId                                          │    │
│  │ - context: { attributedStudents, totalPoints, warnings }    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                           ▼                                             │
│  ┌─ STEP 7: Return Summary ───────────────────────────────────┐        │
│  │ {                                                           │        │
│  │   attributedStudents: 3,                                    │        │
│  │   totalStoryPoints: 21,                                     │        │
│  │   unattributablePoints: 5,                                  │        │
│  │   attributionDetails: [                                     │        │
│  │     {                                                       │        │
│  │       studentId: 'std_001',                                 │        │
│  │       issueKey: 'PROJ-100',                                 │        │
│  │       completedPoints: 5,                                   │        │
│  │       gitHubHandle: 'alice-smith',                          │        │
│  │       decisionReason: 'ATTRIBUTED_VIA_GITHUB_AUTHOR'        │        │
│  │     },                                                      │        │
│  │     ...                                                     │        │
│  │   ],                                                        │        │
│  │   warnings: [                                               │        │
│  │     {                                                       │        │
│  │       issue_key: 'PROJ-105',                                │        │
│  │       reason: 'UNATTRIBUTABLE_GITHUB_NOT_FOUND',            │        │
│  │       github_username: 'unknown-user'                       │        │
│  │     }                                                       │        │
│  │   ]                                                         │        │
│  │ }                                                           │        │
│  └───────────────────────────────────────────────────────────┘        │
│                                                                         │
│ Source Files:                                                           │
│ - backend/src/services/attributionService.js (522 lines)              │
│ - backend/src/services/contributionRecalculateService.js (315 lines)  │
│ - Technical Comments: 690+ lines                                       │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PROCESS 7.4: Contribution Ratio Calculation                             │
│ ═══════════════════════════════════════════════════════════════════════ │
│ Input: D6 ContributionRecord with storyPointsCompleted (from 7.3)      │
│ Process:                                                                 │
│   FOR EACH ContributionRecord:                                          │
│   - contributionRatio = storyPointsCompleted / targetPoints             │
│   - Clamp to [0, 1]                                                     │
│   - Update: ContributionRecord.contributionRatio                        │
│ Output: Per-student contribution ratios                                 │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PROCESS 7.5: Audit Trail & Persistence                                 │
│ ═══════════════════════════════════════════════════════════════════════ │
│ - Log: All attribution decisions with reasoning                         │
│ - Persist: ContributionRecords with ratios                              │
│ - Output: Sprint contribution summary                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model Relationships

```
D1: User (Student Profile)
┌──────────────────────────────┐
│ studentId (PK)               │
│ githubUsername               │ ← Used by Issue #235 (PRIMARY RULE)
│ email                        │
│ ...                          │
└──────────────────────────────┘
           △
           │ f7_ds_d1_p73
           │ (USERNAME LOOKUP)
           │
    ┌──────────────────────┐
    │ attributionService   │
    │ STEP 3: Build map    │
    │ USERNAME → STUDENT   │
    └──────────────────────┘


D2: GroupMembership (Group Members)
┌────────────────────────────────┐
│ groupId (PK)                   │
│ studentId (PK)                 │
│ status (approved/pending/etc.) │ ← Used by Issue #235 (VALIDATION)
│ ...                            │
└────────────────────────────────┘
           △
           │ f7_ds_d2_p73
           │ (MEMBERSHIP VALIDATION)
           │
    ┌──────────────────────────────┐
    │ attributionService           │
    │ STEP 2: Filter approved      │
    │ STEP 4: Check membership     │
    └──────────────────────────────┘


D6: GitHubSyncJob (Process 7.2 Output)
┌────────────────────────────────┐
│ jobId (PK)                     │
│ sprintId                       │
│ groupId                        │
│ validationRecords (array):     │ ← Issue #235 READS
│   - issue_key                  │
│   - pr_author (NEW)            │ ← ADDED by Issue #235
│   - pr_reviewers (NEW)         │ ← ADDED by Issue #235
│   - storyPoints (NEW)          │ ← ADDED by Issue #235
│   - jiraAssignee (NEW)         │ ← ADDED by Issue #235
│   - merge_status               │
│   - ...                        │
└────────────────────────────────┘
           △
           │ f7_p72_p73
           │ (GITHUB SYNC INPUT)
           │
    ┌──────────────────────────────┐
    │ attributionService           │
    │ STEP 1: Read validationRecords│
    │ STEP 4: Process each issue   │
    └──────────────────────────────┘
           │
           ▼
D6: ContributionRecord (Process 7.3 Output)
┌─────────────────────────────────┐
│ sprintId (PK)                   │
│ studentId (PK)                  │
│ groupId (PK)                    │
│ storyPointsCompleted ← WRITTEN  │ ← ISSUE #235 POPULATES THIS
│ targetPoints                    │
│ contributionRatio               │ ← WRITTEN by Process 7.4
│ ...                             │
└─────────────────────────────────┘
```

---

## Code Integration Points

### 1. Service Layer Integration

**Orchestrator Service** (`contributionRecalculateService.js`):
```javascript
async function recalculateSprintContributions(sprintId, groupId, options) {
  // STEP 2: ISSUE #235 — Attribute story points
  const attributionResult = await attributeStoryPoints(
    sprintId,
    groupId,
    { useJiraFallback: options.useJiraFallback }
  );
  
  // attributionResult contains:
  // - attributedStudents (count)
  // - totalStoryPoints
  // - attributionDetails (per-student breakdown)
  // - warnings (unattributable items)
  
  // STEP 3: Process 7.4 — Calculate ratios
  const contributions = await calculateContributionRatios(sprintId, groupId);
  
  // Ratios now include (from Step 2):
  // - storyPointsCompleted: X (populated by Issue #235)
  // - contributionRatio: X / targetPoints
  
  return {
    success: true,
    attribution: attributionResult,
    contributions,
    metrics: { ... }
  };
}
```

### 2. Controller Integration

**Example Endpoint** (needs to be created/updated):
```javascript
// POST /groups/{groupId}/sprints/{sprintId}/contributions/recalculate
router.post('/:groupId/sprints/:sprintId/contributions/recalculate', 
  authMiddleware, 
  async (req, res) => {
    try {
      const { groupId, sprintId } = req.params;
      
      // Call orchestrator (which calls attributionService)
      const result = await recalculateSprintContributions(
        sprintId,
        groupId,
        { useJiraFallback: true }
      );
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Handle attribution errors
      res.status(500).json({
        error: error.message,
        code: error.code || 'ATTRIBUTION_FAILED'
      });
    }
  }
);
```

### 3. Model Integration

**GitHubSyncJob Fields** (populated by Process 7.2):
```javascript
// When Process 7.2 (GitHub Sync Service) runs:
const gitHubSyncJob = new GitHubSyncJob({
  jobId: 'ghsync_abc123',
  sprintId: 'sp_xyz',
  groupId: 'grp_789',
  validationRecords: [
    {
      issue_key: 'PROJ-100',
      pr_author: 'john-doe',           // ← Set by 7.2 GitHub API
      pr_reviewers: ['jane-smith', 'bob-jones'],  // ← Set by 7.2
      merge_status: 'MERGED',
      storyPoints: 5,                  // ← Set by 7.2 JIRA sync
      jiraAssignee: 'team-lead',       // ← Set by 7.2 JIRA sync
      // Process 7.3 (Issue #235) uses these fields ↑↑↑
    }
  ]
});
```

---

## Decision Tree: GitHub → Student Attribution

```
Issue from D6 GitHubSyncJob.validationRecords
├─ Is merge_status === 'MERGED'?
│  ├─ NO → Skip (no story points)
│  └─ YES ↓
│
├─ PRIMARY RULE: GitHub PR Author
│  └─ prAuthor = 'john-doe' (from GitHub)
│     ├─ Query D1: User.find(githubUsername: 'john-doe')
│     │  ├─ NOT FOUND → UNATTRIBUTABLE_GITHUB_NOT_FOUND (warning)
│     │  └─ FOUND → studentId = 'std_001'
│     │
│     ├─ Query D2: GroupMembership.find(studentId: 'std_001', status: 'approved')
│     │  ├─ NOT FOUND → REJECTED_NOT_IN_GROUP (warning)
│     │  └─ FOUND → ATTRIBUTED_VIA_GITHUB_AUTHOR ✓
│     │     └─ Accumulate: storyPoints += 5
│     │
│     └─ FALLBACK (if primary failed AND useJiraFallback enabled)
│        ├─ If jiraAssignee exists
│        │  └─ Same D1+D2 lookup on jiraAssignee
│        │     ├─ FOUND AND approved → ATTRIBUTED_VIA_JIRA_ASSIGNEE_FALLBACK ✓
│        │     └─ NOT approved → REJECTED_FALLBACK_NOT_IN_GROUP (warning)
│        │
│        └─ If no fallback → Log warning (unattributable)
│
└─ Final Decision: Accumulate (or warn)
   └─ Write: D6 ContributionRecord.storyPointsCompleted
      └─ Used by Process 7.4 for ratio calculation
```

---

## Error Handling & Warnings

### Non-Fatal Errors (Logged, Processing Continues)

```
Warning: UNATTRIBUTABLE_GITHUB_NOT_FOUND
├─ Issue: PROJ-100
├─ GitHub PR Author: 'unknownguy'
├─ Reason: GitHub username not found in D1 (User collection)
├─ Action: Log warning, skip this issue
└─ Code: warnings.push({ issue_key, reason, github_username })

Warning: REJECTED_NOT_IN_GROUP
├─ Issue: PROJ-101
├─ GitHub PR Author: 'external-contributor'
├─ Reason: GitHub user found in D1 but NOT approved member of group
├─ Action: Log warning, skip this issue
└─ Code: if (!approvedStudentIds.has(studentId)) { ... }

Warning: REJECTED_FALLBACK_NOT_IN_GROUP
├─ Issue: PROJ-102
├─ JIRA Assignee: 'unrelated-user'
├─ Reason: JIRA assignee not in group (fallback failed)
├─ Action: Log warning, skip this issue
└─ Code: Fallback logic line 280+

Warning: NO_GITHUB_SYNC_JOB
├─ Sprint: sp_xyz
├─ Reason: No GitHubSyncJob found (Process 7.2 not run yet)
├─ Action: Return empty attribution (no errors)
└─ Code: if (!githubSyncJob) { return { ... warning } }
```

### Fatal Errors (Throw Exception)

```
Error: SPRINT_NOT_FOUND
├─ Reason: sprintId not found in D6 SprintRecord
├─ HTTP Status: 404
└─ Code: throw new AttributionServiceError(...)

Error: GROUP_NOT_FOUND
├─ Reason: groupId not found in D2 Group
├─ HTTP Status: 404
└─ Code: throw new AttributionServiceError(...)

Error: ATTRIBUTION_FAILED
├─ Reason: Unexpected exception (database, logic error)
├─ HTTP Status: 500
└─ Code: catch block in controller
```

---

## Testing Scenarios

### TC-1: Happy Path (Merged PR + Student in Group)

```
Setup:
- D6: GitHubSyncJob with pr_author='john-doe', merge_status='MERGED', storyPoints=5
- D1: User with studentId='std_001', githubUsername='john-doe'
- D2: GroupMembership(groupId, studentId='std_001', status='approved')

Execution:
$ attributeStoryPoints(sprintId, groupId)

Expected:
- ContributionRecord created: { storyPointsCompleted: 5 }
- Attribution: ATTRIBUTED_VIA_GITHUB_AUTHOR
- Warning: None
- Result: { attributedStudents: 1, totalStoryPoints: 5 }
```

### TC-2: Rejection (Student Not in Group)

```
Setup:
- D6: GitHubSyncJob with pr_author='bob-smith', merge_status='MERGED', storyPoints=3
- D1: User with studentId='std_002', githubUsername='bob-smith'
- D2: NO GroupMembership for groupId + std_002

Execution:
$ attributeStoryPoints(sprintId, groupId)

Expected:
- ContributionRecord NOT created
- Attribution: REJECTED_NOT_IN_GROUP
- Warning: Yes (logged with issue_key + username)
- Result: { attributedStudents: 0, totalStoryPoints: 0, unattributablePoints: 3 }
```

### TC-3: Partial Merge (Not Merged)

```
Setup:
- D6: GitHubSyncJob with pr_author='alice-jones', merge_status='NOT_MERGED', storyPoints=8
- D1: User exists
- D2: GroupMembership exists

Execution:
$ attributeStoryPoints(sprintId, groupId)

Expected:
- ContributionRecord NOT created
- Issue SKIPPED (merge_status check)
- No warning (partial merges silently skipped)
- Result: { attributedStudents: 0, totalStoryPoints: 0 }
```

### TC-6: Idempotency (Same Result on Re-run)

```
Setup:
- Same D6, D1, D2 as TC-1
- Run twice

Execution:
$ result1 = attributeStoryPoints(sprintId, groupId)
$ result2 = attributeStoryPoints(sprintId, groupId)

Expected:
- result1 === result2 (exactly identical)
- D6 ContributionRecord updated (not duplicated)
- No accumulation errors
```

---

## Integration Checklist

Before deploying Issue #235 to production:

- [ ] **Syntax Validation**: All files pass `node -c`
- [ ] **Linting**: ESLint issues resolved
- [ ] **Unit Tests**: All 8 test cases pass
- [ ] **Process 7.2**: GitHub sync service writing pr_author, storyPoints
- [ ] **Process 7.4**: Ratio calculation receiving storyPointsCompleted
- [ ] **Controller**: POST endpoint calling recalculateSprintContributions
- [ ] **Models**: GitHubSyncJob schema includes new fields (prAuthor, storyPoints, etc.)
- [ ] **Audit Logging**: STORY_POINTS_ATTRIBUTED events created
- [ ] **Error Handling**: Non-fatal warnings logged, fatal errors caught
- [ ] **Performance**: Tested with 500+ validationRecords
- [ ] **Documentation**: 690+ technical comments in code
- [ ] **Rollback Plan**: If needed, disable attributionService call

---

## Performance Considerations

### Current Implementation

- **Time Complexity**: O(n) where n = number of validationRecords
- **Space Complexity**: O(m) where m = number of attributed students
- **D1 Lookups**: O(m) queries (batched by Mongoose)
- **D2 Queries**: 1 query for entire group membership

### For Large Sprints (1000+ issues)

**Optimization Ideas** (future):
1. Cache D1 User.githubUsername map (Redis)
2. Batch D1 lookups: User.find(githubUsername: { $in: [...] })
3. Index D2 on (groupId, status) for faster filtering
4. Parallel processing of validation records (async batch)

### Recommended Limits

- **Max Issues per Attribution**: 5,000 (current)
- **Max Students per Group**: 500
- **Timeout**: 30 seconds

---

## Monitoring & Observability

### Metrics to Track

```
Attribution Results:
- attributedStudents (success count)
- totalStoryPoints (successfully attributed)
- unattributablePoints (warnings)
- warningCount (issues with unattributable GitHub users)

Performance:
- executionTime (ms)
- D1 lookups (count)
- D2 queries (count)
- ContributionRecords upserted (count)

Errors:
- SPRINT_NOT_FOUND (fatal)
- GROUP_NOT_FOUND (fatal)
- ATTRIBUTION_FAILED (fatal)
- UNATTRIBUTABLE_GITHUB_NOT_FOUND (warning count)
- REJECTED_NOT_IN_GROUP (warning count)
```

### Logging Example

```json
{
  "timestamp": "2026-04-22T14:30:00Z",
  "level": "INFO",
  "service": "attributionService",
  "function": "attributeStoryPoints",
  "sprintId": "sp_xyz",
  "groupId": "grp_789",
  "action": "STORY_POINTS_ATTRIBUTED",
  "result": {
    "attributedStudents": 3,
    "totalStoryPoints": 21,
    "unattributablePoints": 5,
    "warnings": [
      {
        "issue_key": "PROJ-105",
        "reason": "UNATTRIBUTABLE_GITHUB_NOT_FOUND",
        "github_username": "unknown-user"
      }
    ]
  },
  "executionTimeMs": 245,
  "d1LookupCount": 3,
  "d2QueryCount": 1
}
```

