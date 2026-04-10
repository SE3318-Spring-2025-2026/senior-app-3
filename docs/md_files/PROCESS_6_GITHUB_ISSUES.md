# Process 6 - GitHub Issues (Ready to Post)

> **Scope note:** The actual DFD (`dfdLevel2_Process6.drawio`) defines **3 sub-processes**: 6.1 Assign Review to Committee, 6.2 Collect Review Comments & Marks, 6.3 Mark Sections & Log Reviews. This matches the API spec (v2.6.0) exactly. There is no rubric scoring or evaluation aggregation in this process. This file implements all 3 sub-processes.

---

## Issue #1: Backend - Auth Middleware for Review Routes

**Priority:** 🔴 P0 - Critical | **Type:** Backend Infrastructure | **Story Points:** 3  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process6-middleware`

### Description
Wire JWT auth middleware onto all Process 6 routes with role-based access control. Reuses the auth middleware created in Process 5 (Issue #1) but registers it on the new `reviews` and deliverable comment routes with the correct role restrictions.

### Acceptance Criteria
- [ ] `backend/src/routes/reviews.js` created and mounted at `/api/reviews`
- [ ] All `/api/reviews/*` routes require JWT (401 if missing/invalid)
- [ ] `POST /api/reviews/assign` restricted to `coordinator` role — return 403 for others
- [ ] `GET /api/reviews/status` restricted to `coordinator` role
- [ ] `/api/deliverables/:deliverableId/comments/*` routes require JWT — accessible by `committee_member`, `coordinator`, and `student` (students can only reply, not initiate comments)
- [ ] `req.user = { userId, role, groupId }` available in all review controllers

### Files
- Create: `backend/src/routes/reviews.js`
- Update: `backend/src/routes/deliverables.js` (add comment sub-routes)

---

## Issue #2: Backend - Review Assignment Endpoint

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process6-assign-review`

### Description
Implement Process 6.1: coordinator assigns a deliverable to committee members for review. Fetches committee members from D3, creates review task records, and triggers assignment notifications. This is the entry point to the entire Process 6 workflow.

### Acceptance Criteria
- [ ] `POST /api/reviews/assign` endpoint:
  - Requires JWT (`coordinator` role — return 403 otherwise)
  - Request body:
    ```json
    {
      "deliverableId": "del_5e8f9d2a3c",
      "reviewDeadlineDays": 7,
      "selectedCommitteeMembers": ["userId1", "userId2"],
      "instructions": "Focus on architecture section."
    }
    ```
  - `reviewDeadlineDays`: required, integer 1–30
  - `selectedCommitteeMembers`: optional — if omitted, all committee members assigned to the group (from D3) are selected automatically
  - `instructions`: optional free text

- [ ] Validation:
  - Deliverable must exist in D4 with `status === 'accepted'` — return 404 if not found, 400 if wrong status
  - Return 409 if a review is already assigned for this deliverable (prevent duplicate)
  - Each `selectedCommitteeMembers` userId must exist in D3 as active committee member — return 400 with invalid member IDs

- [ ] Creates one `Review` document with:
  - `reviewId`, `deliverableId`, `groupId` (from deliverable), `deadline` (now + reviewDeadlineDays)
  - `assignedMembers`: array of `{ memberId, status: 'notified' }`
  - `status: 'pending'`
  - `instructions`
  - `createdAt`

- [ ] Updates Deliverable `status` to `'under_review'`

- [ ] Creates review record in D5 (Reviews & Clarifications)
- [ ] Triggers async notification to each assigned committee member (DFD flow f14: 6.1 → Notification Service) and sends review assignment + deliverable link to committee member (DFD flow f13: 6.1 → Committee Member) — does not block response
- [ ] This endpoint is triggered automatically when Process 5 completes (DFD flow f1: Student/Team → 6.1 "submission for review") but can also be manually invoked by coordinator (DFD flow f11: Coordinator → 6.1 "review schedule + deadline")

- [ ] Return 201:
  ```json
  {
    "deliverableId": "del_5e8f9d2a3c",
    "reviewId": "rev_5e8f9d2a3c",
    "assignedCommitteeMembers": [
      { "memberId": "u1", "name": "Ali Yılmaz", "email": "ali@uni.edu", "status": "notified" }
    ],
    "assignedCount": 3,
    "deadline": "<ISO>",
    "notificationsSent": 3,
    "instructions": "Focus on architecture section."
  }
  ```

### Files
- Create: `backend/src/controllers/reviewController.js`
- Update: `backend/src/routes/reviews.js`

### Depends On
- Issue #1 (auth middleware)
- Issue #4 (Review model must exist)

---

## Issue #3: Backend - Review & Comment Models

**Priority:** 🔴 P0 - Critical | **Type:** Backend Infrastructure | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process6-review-models`

### Description
Create the `Review` and `Comment` Mongoose models for Process 6. The `Comment` model is the core data structure — it covers general comments, clarification requests, and replies in a single unified thread (per API spec design).

### Acceptance Criteria
- [ ] `Review` Mongoose model (`backend/src/models/Review.js`):
  - `reviewId` (UUID, unique)
  - `deliverableId` (ref to Deliverable)
  - `groupId`
  - `status` enum: `['pending', 'in_progress', 'needs_clarification', 'completed']`
  - `assignedMembers`: array of `{ memberId, status: enum['notified', 'accepted', 'started'] }`
  - `deadline` (Date)
  - `instructions` (String, nullable)
  - `createdAt`, `updatedAt`
  - Indexes: `{ deliverableId: 1 }` (unique), `{ status: 1 }`

- [ ] `Comment` Mongoose model (`backend/src/models/Comment.js`):
  - `commentId` (UUID, unique)
  - `deliverableId` (ref to Deliverable)
  - `authorId` (userId)
  - `authorName` (String)
  - `content` (String, 1–5000 chars, markdown supported)
  - `commentType` enum: `['general', 'question', 'clarification_required', 'suggestion', 'praise']`, default `'general'`
  - `sectionNumber` (Integer, nullable — for referencing specific section of document)
  - `needsResponse` (Boolean, default false — marks as requiring acknowledgment from group)
  - `status` enum: `['open', 'resolved', 'acknowledged']`, default `'open'`
  - `replies`: array of `{ replyId (UUID), authorId, content (1–2000 chars), createdAt }`
  - `createdAt`, `updatedAt`
  - Indexes: `{ deliverableId: 1, createdAt: 1 }`, `{ deliverableId: 1, status: 1 }`

- [ ] Migration `backend/src/migrations/008_create_review_schema.js`:
  - Creates `Review` collection with indexes
  - Creates `Comment` collection with indexes
  - Does NOT modify `Deliverable` collection (score fields are out of scope for this sprint)

### Files
- Create: `backend/src/models/Review.js`
- Create: `backend/src/models/Comment.js`
- Create: `backend/src/migrations/008_create_review_schema.js`

---

## Issue #4: Backend - Add Comment & Get Comment Thread Endpoints

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process6-comments`

### Description
Implement Process 6.2 comment endpoints: committee members add comments (general or clarification requests) to a deliverable, and all parties can retrieve the full comment thread. This is the primary interaction mechanism for the review — not a one-shot form submission.

### Acceptance Criteria
- [ ] `POST /api/deliverables/:deliverableId/comments` — add a comment:
  - Requires JWT (`committee_member` or `coordinator` role — students cannot initiate comments, return 403)
  - Deliverable must exist and have an active review (`status: 'under_review'`) — return 404/400 if not
  - Request body:
    ```json
    {
      "content": "This section needs clarification.",
      "commentType": "clarification_required",
      "sectionNumber": 3,
      "needsResponse": true
    }
    ```
  - `content`: required, 1–5000 chars
  - `commentType`: optional, default `'general'`
  - `sectionNumber`: optional, nullable
  - `needsResponse`: optional, default false
  - Creates `Comment` document in D5, return 201 with created comment
  - If `needsResponse: true` — triggers async notification to student group (DFD flow f10)
  - Updates Review `status` to `'in_progress'` if it was `'pending'`
  - If any `needsResponse: true` comment is open, updates Review `status` to `'needs_clarification'`

- [ ] `GET /api/deliverables/:deliverableId/comments` — retrieve comment thread:
  - Requires JWT (any authenticated role)
  - Students can only view comments on their own group's deliverables — return 403 otherwise
  - Query params: `sortBy` (`timestamp`|`author`|`section`|`status`, default `timestamp`), `status` (`open`|`resolved`|`acknowledged`), `page` (default 1)
  - Return 200:
    ```json
    {
      "deliverableId": "del_5e8f9d2a3c",
      "comments": [...],
      "totalCount": 12,
      "openClarificationCount": 3
    }
    ```

### Files
- Update: `backend/src/controllers/reviewController.js`
- Update: `backend/src/routes/deliverables.js`

### Depends On
- Issues #1, #3

---

## Issue #5: Backend - Edit/Resolve Comment & Group Reply Endpoints

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process6-comment-actions`

### Description
Implement the remaining comment interaction endpoints from the API spec: editing/resolving a comment (committee/coordinator) and group replies to clarification requests (students). Together with Issue #4, these form the complete Process 6.2 flow.

### Acceptance Criteria
- [ ] `PATCH /api/deliverables/:deliverableId/comments/:commentId` — edit or resolve a comment:
  - Requires JWT
  - Only the comment author can edit `content` — return 403 otherwise
  - `coordinator` or comment author can update `status`
  - Request body (all optional):
    ```json
    { "content": "Updated text.", "status": "resolved" }
    ```
  - `status` enum: `['open', 'resolved', 'acknowledged']`
  - After update: if no more `open` comments with `needsResponse: true` exist on the deliverable, update Review `status` back to `'in_progress'`
  - Return 200 with updated comment

- [ ] `POST /api/deliverables/:deliverableId/comments/:commentId/reply` — group replies to clarification:
  - Requires JWT (`student` role — this is how students respond to clarification requests)
  - Comment must exist and belong to this deliverable — return 404 otherwise
  - `coordinator` and `committee_member` can also reply
  - Request body: `{ "content": "Here is our clarification..." }` (required, 1–2000 chars)
  - Appends to `comment.replies[]` with `{ replyId, authorId, content, createdAt }`
  - Return 201 with the updated comment (including new reply)
  - Triggers async notification to the comment author (reviewer gets notified of student reply, DFD flow back to 6.2)
  - If `comment.needsResponse` was true, auto-sets `comment.status = 'acknowledged'`

### Files
- Update: `backend/src/controllers/reviewController.js`
- Update: `backend/src/routes/deliverables.js`

### Depends On
- Issues #1, #3, #4

---

## Issue #6: Backend - Review Status Overview Endpoint

**Priority:** 🟠 P1 - High | **Type:** Backend Feature | **Story Points:** 5  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process6-review-status`

### Description
Implement the coordinator's review status dashboard endpoint (Process 6.3 logging). Gives a live overview of all reviews — how many are pending, in progress, blocked on clarification, or completed.

### Acceptance Criteria
- [ ] `GET /api/reviews/status` endpoint:
  - Requires JWT (`coordinator` role — return 403 otherwise)
  - Query params: `status` (filter: `pending`|`in_progress`|`needs_clarification`|`completed`), `page` (default 1)
  - Aggregates across all `Review` documents
  - Return 200:
    ```json
    {
      "total": 24,
      "statuses": {
        "pending": 5,
        "in_progress": 10,
        "needs_clarification": 4,
        "completed": 5
      },
      "reviews": [
        {
          "deliverableId": "del_...",
          "groupId": "grp_...",
          "deliverableType": "interim_report",
          "sprintId": "sprint_2024_s1",
          "reviewStatus": "needs_clarification",
          "commentCount": 8,
          "clarificationsRemaining": 2,
          "deadline": "<ISO>"
        }
      ]
    }
    ```
  - `clarificationsRemaining`: count of `Comment` documents for this deliverable with `needsResponse: true` AND `status: 'open'`

- [ ] A review is automatically marked `'completed'` when:
  - All `needsResponse` comments are resolved/acknowledged (no open clarifications)
  - This check runs whenever a comment is resolved (Issues #4, #5) — update Review status accordingly

### Files
- Update: `backend/src/controllers/reviewController.js`
- Update: `backend/src/routes/reviews.js`

### Depends On
- Issues #1, #3

---

## Issue #7: Backend - Review Notification Service

**Priority:** 🟠 P1 - High | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process6-notifications`

### Description
Implement notification functions for all Process 6 events. Uses Nodemailer with SMTP config from env vars (same setup as Process 5). All notifications are async and must not block the API response.

### Acceptance Criteria
- [ ] Uses **Nodemailer** with env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (reuse Process 5 mail transport instance if already initialized)

- [ ] `notifyReviewerAssigned(reviewId, memberId)`:
  - Triggered by Issue #2 (assignment endpoint)
  - Queries D3 for member email
  - Template `review-assignment.txt`: `"You have been assigned to review deliverable #{{deliverableId}} from {{groupName}}. Deadline: {{deadline}}. Instructions: {{instructions}}"`

- [ ] `notifyClarificationRequested(commentId, groupId)`:
  - Triggered by Issue #4 when `needsResponse: true` comment is added
  - Queries D2 for group member emails
  - Template `review-clarification-request.txt`: `"Clarification requested on your deliverable #{{deliverableId}}: {{commentContent}}"`

- [ ] `notifyStudentReplied(commentId, reviewerId)`:
  - Triggered by Issue #5 when a student posts a reply
  - Queries D3 for reviewer email
  - Template `review-clarification-reply.txt`: `"Group {{groupName}} replied to your clarification on deliverable #{{deliverableId}}: {{replyContent}}"`

- [ ] `notifyReviewCompleted(reviewId)`:
  - Triggered when Review status changes to `'completed'` (Issue #6)
  - Sends to coordinator (D1): template `review-completed-coordinator.txt`: `"Review of deliverable #{{deliverableId}} from {{groupName}} is complete. Open clarifications: 0. See full comment thread at: {{link}}"` (DFD flow f12: 6.3 → Coordinator "review completion + results report")
  - Sends to group members (D2): template `review-completed-student.txt`: `"The review of your deliverable #{{deliverableId}} is complete. Section feedback summary: {{sectionSummary}}. All clarifications resolved."` (DFD flow f10: 6.3 → Student "section status + final feedback")
  - Sends to assigned committee members (D3): template `review-completed-committee.txt`: `"Review of deliverable #{{deliverableId}} has been logged as complete."`
  - DFD flow f17: 6.3 → Notification Service (review complete event)

- [ ] Each function: retry up to **3 times** with exponential backoff (1s, 2s, 4s). Failure is logged, does not throw.

- [ ] All notifications logged to audit trail with `{ type, recipientId, deliverableId, sentAt, success }`

### Files
- Create: `backend/src/services/reviewNotificationService.js`
- Create: `backend/src/templates/review-assignment.txt`
- Create: `backend/src/templates/review-clarification-request.txt`
- Create: `backend/src/templates/review-clarification-reply.txt`
- Create: `backend/src/templates/review-completed-coordinator.txt`
- Create: `backend/src/templates/review-completed-student.txt`
- Create: `backend/src/templates/review-completed-committee.txt`

### Depends On
- Issues #2, #4, #5, #6

---

## Issue #8: Frontend - Review Management Dashboard (Coordinator)

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process6-review-dashboard`

### Description
Create the coordinator-only React page for managing review assignments and monitoring review progress. Lives at `/dashboard/reviews`.

### Acceptance Criteria
- [ ] Page `frontend/src/pages/ReviewManagement.jsx`:
  - Accessible by `coordinator` role only — redirect to `/dashboard` if student
  - Calls `GET /api/reviews/status` on load to populate the dashboard
  - Shows counts: pending / in_progress / needs_clarification / completed (as stat cards)

- [ ] Review list table showing each review with:
  - `deliverableId`, `deliverableType` (from enum: `proposal`, `statement_of_work`, `demo`, `interim_report`, `final_report`), `groupId`, `sprintId`, `reviewStatus`, `commentCount`, `clarificationsRemaining`, `deadline`
  - Filter by `status` (dropdown): `pending` | `in_progress` | `needs_clarification` | `completed`
  - Pagination: 20 per page

- [ ] Assignment form `frontend/src/components/reviews/ReviewAssignmentForm.jsx`:
  - Triggered by clicking a deliverable with `status: 'accepted'` (not yet assigned)
  - Fields: `deliverableId` (pre-filled), `reviewDeadlineDays` (number input, 1–30, required), `selectedCommitteeMembers` (multi-select from fetched committee list, optional), `instructions` (textarea, optional)
  - On submit: calls `POST /api/reviews/assign`
  - Success: shows confirmation with `assignedCount` and `deadline`, refreshes list
  - Error: shows message from API `code` field

- [ ] Loading states for all API calls
- [ ] Responsive, TailwindCSS styled
- [ ] Accessibility: table headers, keyboard navigable form

### Files
- Create: `frontend/src/pages/ReviewManagement.jsx`
- Create: `frontend/src/components/reviews/ReviewAssignmentForm.jsx`
- Create: `frontend/src/api/reviewAPI.js`

### Depends On
- Issues #2, #6 (API endpoints ready)

---

## Issue #9: Frontend - Comment Thread & Review Form (Committee Member)

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process6-review-form`

### Description
Create the committee member review interface: view the deliverable, add comments/clarification requests, and see the full comment thread. Also used by students to reply to clarifications.

### Acceptance Criteria
- [ ] Page `frontend/src/pages/ReviewPage.jsx` at `/dashboard/reviews/:deliverableId`:
  - Fetches deliverable details and `GET /api/deliverables/:deliverableId/comments` on load
  - Left panel: deliverable metadata (type, group, submitted at, sprint)
  - Right panel: comment thread + add comment form

- [ ] Comment thread component `frontend/src/components/reviews/CommentThread.jsx`:
  - Lists all comments sorted by timestamp (default)
  - Each comment shows: `authorName`, `content` (rendered markdown), `commentType` badge, `sectionNumber` if set, `status` badge (`open`/`resolved`/`acknowledged`), `createdAt`
  - If `needsResponse: true` → highlighted with a "Needs Response" indicator
  - Shows replies nested under their parent comment
  - Filter bar: filter by `status` (`open`|`resolved`|`acknowledged`)

- [ ] Add comment form `frontend/src/components/reviews/AddCommentForm.jsx` (committee/coordinator only):
  - `content` textarea (required, 1–5000 chars, markdown supported)
  - `commentType` dropdown: `general` | `question` | `clarification_required` | `suggestion` | `praise`
  - `sectionNumber` number input (optional)
  - `needsResponse` checkbox (shown only when `commentType` is `clarification_required`)
  - Submit → `POST /api/deliverables/:deliverableId/comments`

- [ ] Edit/resolve comment: comment author sees "Edit" button → inline edit, "Resolve" button → calls `PATCH` to set `status: 'resolved'`

- [ ] Reply form (students and committee):
  - "Reply" button on each comment → expands inline reply textarea
  - Submit → `POST /api/deliverables/:deliverableId/comments/:commentId/reply`
  - New reply appears immediately in thread

- [ ] Loading and error states for all API calls
- [ ] Responsive, TailwindCSS styled
- [ ] Accessibility: proper heading structure, reply forms announced to screen readers

### Files
- Create: `frontend/src/pages/ReviewPage.jsx`
- Create: `frontend/src/components/reviews/CommentThread.jsx`
- Create: `frontend/src/components/reviews/AddCommentForm.jsx`
- Update: `frontend/src/api/reviewAPI.js`

### Depends On
- Issues #4, #5 (API endpoints ready)

---

## Issue #10: Backend Testing - Assignment & Comment Endpoints (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process6-assignment-tests`

### Description
Comprehensive tests for Issues #2, #4, and #5 (review assignment, add comment, edit/resolve comment, student reply).

### Acceptance Criteria
- [ ] Tests for Issue #2 (`POST /reviews/assign`):
  - Valid assignment with all fields → 201, Review created, Deliverable updated to `under_review`
  - `selectedCommitteeMembers` omitted → all D3 members assigned
  - Non-coordinator calls → 403
  - Deliverable not found → 404
  - Deliverable not in `'accepted'` status → 400
  - Review already exists for this deliverable → 409
  - Invalid member IDs → 400 with list of bad IDs
  - `reviewDeadlineDays` missing → 400

- [ ] Tests for Issue #4 (`POST` and `GET` comments):
  - Student adds comment → 403
  - Committee member adds `clarification_required` comment with `needsResponse: true` → 201, Review status updated to `needs_clarification`
  - GET returns paginated list with `openClarificationCount`
  - Student fetches comments for own group → 200
  - Student fetches comments for another group → 403

- [ ] Tests for Issue #5 (`PATCH` and reply `POST`):
  - Author edits own comment content → 200
  - Non-author edits content → 403
  - Coordinator resolves any comment → 200, Review status updated if no open clarifications remain
  - Student replies to clarification → 201, `comment.status` auto-set to `'acknowledged'`
  - Reply on non-existent comment → 404

- [ ] Minimum 80% code coverage
- [ ] Use mongoose-memory-server for all tests

### Files
- Create: `backend/tests/review-assignment.test.js`
- Create: `backend/tests/review-comments.test.js`
- Create: `backend/tests/fixtures/review-test-data.js`

### Depends On
- Issues #2, #4, #5

---

## Issue #11: Backend Testing - Status & Notification Tests (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process6-status-tests`

### Description
Tests for Issues #6 and #7 (review status endpoint and notification service).

### Acceptance Criteria
- [ ] Status endpoint tests (`GET /reviews/status`):
  - Non-coordinator → 403
  - Returns correct counts per status bucket
  - `clarificationsRemaining` accurately counts open `needsResponse` comments
  - Filter by status → only matching reviews returned
  - Review auto-completed when last open clarification resolved

- [ ] Notification tests:
  - `notifyReviewerAssigned`: email sent to each assigned member
  - `notifyClarificationRequested`: all group members emailed
  - `notifyStudentReplied`: reviewer emailed with reply content
  - `notifyReviewCompleted`: coordinator, committee, and students all notified
  - Email failure → not thrown, logged to audit trail
  - Retry logic → retries 3 times with backoff, stops on success
  - All notifications appear in audit log with correct fields

- [ ] Minimum 80% code coverage
- [ ] Mock Nodemailer transport, mongoose-memory-server

### Files
- Create: `backend/tests/review-status.test.js`
- Create: `backend/tests/review-notifications.test.js`

### Depends On
- Issues #6, #7

---

## Issue #12: Frontend Testing - Review Dashboard (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process6-dashboard-tests`

### Description
Unit tests for `ReviewManagement` page and `ReviewAssignmentForm` (Issue #8).

### Acceptance Criteria
- [ ] Page renders with stat cards (pending/in_progress/needs_clarification/completed counts)
- [ ] Review list shows correct columns with data from mocked `GET /reviews/status`
- [ ] Filter dropdown changes shown list
- [ ] Pagination fetches next page
- [ ] Non-coordinator is redirected
- [ ] Assignment form: renders on deliverable click
- [ ] `reviewDeadlineDays` required — submit disabled if empty
- [ ] `selectedCommitteeMembers` multi-select works
- [ ] Submit calls `POST /reviews/assign` with correct body including `reviewDeadlineDays`
- [ ] Success → confirmation shown, list refreshes
- [ ] API error → error message shown with `code` field
- [ ] Loading states visible during API calls
- [ ] Minimum 80% code coverage, mock all API calls

### Files
- Create: `frontend/src/pages/__tests__/ReviewManagement.test.js`
- Create: `frontend/src/components/reviews/__tests__/ReviewAssignmentForm.test.js`

### Depends On
- Issue #8

---

## Issue #13: Frontend Testing - Comment Thread & Review Form (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process6-comment-tests`

### Description
Unit tests for `ReviewPage`, `CommentThread`, and `AddCommentForm` (Issue #9).

### Acceptance Criteria
- [ ] `ReviewPage` renders deliverable metadata and comment thread from mocked API
- [ ] `CommentThread`:
  - All comments listed with correct badges (`commentType`, `status`)
  - `needsResponse: true` comments highlighted
  - Replies shown nested under parent
  - Filter by status works
- [ ] `AddCommentForm` (committee only):
  - All fields render
  - `needsResponse` checkbox shown only when `commentType === 'clarification_required'`
  - Submit disabled if `content` empty
  - Submit calls `POST /api/deliverables/:id/comments` with correct body
  - Success → new comment appears in thread immediately
- [ ] Edit comment:
  - "Edit" button only visible to comment author
  - Saves updated content via `PATCH`
- [ ] Resolve comment: "Resolve" sets `status: 'resolved'` via `PATCH`
- [ ] Reply form:
  - "Reply" button expands inline textarea
  - Submit calls `POST .../reply` with `content`
  - New reply appears immediately
  - For student role: reply auto-acknowledges parent comment
- [ ] Loading and error states tested for each API call
- [ ] Student cannot see `AddCommentForm`
- [ ] Minimum 80% code coverage, mock all API calls

### Files
- Create: `frontend/src/pages/__tests__/ReviewPage.test.js`
- Create: `frontend/src/components/reviews/__tests__/CommentThread.test.js`
- Create: `frontend/src/components/reviews/__tests__/AddCommentForm.test.js`

### Depends On
- Issue #9

---

## Summary

| # | Title | Dev | Type | SP | Phase |
|---|-------|-----|------|-----|-------|
| 1 | Auth Middleware for Review Routes | FS-Dev1 | Backend Infra | 3 | 1 |
| 2 | Review Assignment Endpoint | FS-Dev1 | Backend | 8 | 1-2 |
| 3 | Review & Comment Models | FS-Dev2 | Backend Infra | 8 | 1 |
| 4 | Add Comment & Get Thread Endpoints | FS-Dev1 | Backend | 8 | 2-3 |
| 5 | Edit/Resolve Comment & Reply Endpoints | FS-Dev2 | Backend | 8 | 3-4 |
| 6 | Review Status Overview Endpoint | FS-Dev2 | Backend | 5 | 4 |
| 7 | Review Notification Service | Back-Dev | Backend | 8 | 4-5 |
| 8 | Review Management Dashboard (Coordinator) | Front-Dev | Frontend | 8 | 5-6 |
| 9 | Comment Thread & Review Form (Committee) | Front-Dev | Frontend | 8 | 6-7 |
| 10 | Assignment & Comment Tests | Back-Test | Testing | 8 | 7-8 |
| 11 | Status & Notification Tests | Back-Test | Testing | 8 | 7-8 |
| 12 | Dashboard Tests | Front-Test | Testing | 8 | 8-9 |
| 13 | Comment Thread Tests | Front-Test | Testing | 8 | 8-9 |

**Total: 96 SP | Coverage: 80%+ | Conflicts: 0%**

### Process Flow (for reference)
```
Coordinator assigns review
  → Issue #2: POST /reviews/assign → Review created [status: pending]
      → Issue #7: notifyReviewerAssigned → committee members emailed

Committee member reads deliverable & adds comments
  → Issue #4: POST /deliverables/:id/comments → Comment created [status: open]
      → if needsResponse: true → Review [status: needs_clarification]
      → Issue #7: notifyClarificationRequested → group emailed

Student replies to clarification
  → Issue #5: POST /deliverables/:id/comments/:commentId/reply
      → comment.status auto-set to 'acknowledged'
      → Issue #7: notifyStudentReplied → reviewer emailed

Coordinator/reviewer resolves all clarifications
  → Issue #5: PATCH /deliverables/:id/comments/:commentId { status: 'resolved' }
      → when no open needsResponse comments remain → Review [status: completed]
      → Issue #7: notifyReviewCompleted → all stakeholders emailed

Coordinator monitors progress
  → Issue #6: GET /reviews/status → live overview of all reviews
```

### DFD Coverage
All 3 sub-processes in `dfdLevel2_Process6.drawio` are covered:
- ✅ 6.1 Assign Review to Committee → Issue #2
- ✅ 6.2 Collect Review Comments & Marks → Issues #4, #5
- ✅ 6.3 Mark Sections & Log Reviews → Issue #6 (status), Issue #7 (notifications)

All DFD data flows covered:
- ✅ f1: Student → 6.1 (auto-triggered from Process 5) → Issue #2
- ✅ f2: 6.1 → 6.2 (review assignment + instructions) → Issue #2 creates Review, Issue #4 reads it
- ✅ f3: 6.2 → 6.3 (review data + comments collected) → Issue #6 aggregates
- ✅ f5: D3 → 6.1 (committee assignment list) → Issue #2
- ✅ f6: D4 → 6.2 (deliverable content + files) → Issue #4 (deliverable lookup)
- ✅ f7: 6.2 → D5 (store comments + clarifications) → Issue #4
- ✅ f8: 6.3 → D5 (store section marks + review status) → Issue #6
- ✅ f9: 6.2 → Student (clarification request) → Issue #4 (needsResponse notification)
- ✅ f10: 6.3 → Student (section status + final feedback) → Issue #7 (review-completed-student template)
- ✅ f11: Coordinator → 6.1 (review schedule + deadline) → Issue #2
- ✅ f12: 6.3 → Coordinator (review completion + results report) → Issue #7 (review-completed-coordinator template)
- ✅ f13: 6.1 → Committee Member (review assignment + deliverable link) → Issue #7 (review-assignment notification)
- ✅ f14: 6.1 → Notification Service (review assigned event) → Issue #7
- ✅ f16: Committee Member → 6.2 (committee comments + section marks) → Issues #4, #5
- ✅ f17: 6.3 → Notification Service (review complete event) → Issue #7
