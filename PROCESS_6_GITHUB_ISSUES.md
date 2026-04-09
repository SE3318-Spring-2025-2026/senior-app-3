# Process 6 - GitHub Issues (Ready to Post)

---

## Issue #1: Backend - Review Assignment & Retrieval Endpoint

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process6-assign-review`

### Description
Implement endpoint to assign deliverables to committee members for review. Process 6.1 (Assign Review to Committee) - retrieves pending deliverables and assigns them.

### Acceptance Criteria
- [ ] `GET /api/reviews/pending-assignements` endpoint returns:
  - List of unassigned deliverables from D4
  - Includes groupId, deliverableId, submittedAt, type
  - Paginated: limit 20 per page

- [ ] `POST /api/reviews/assign` endpoint assigns deliverables:
  - Body: `{ deliverableId, committeeMembers: [userId] }`
  - Creates review records with status: 'assigned'
  - Returns: `{ reviewIds: [], assignedAt }`

- [ ] Validates:
  - Committee members exist and are active
  - Deliverable exists and is in 'submitted' status
  - No duplicate assignments

- [ ] Updates D5 (Reviews &amp; Clarifications) with review assignment
- [ ] Sends notification to assigned committee members (uses notification service from Process 5)

### Files
- Create: `backend/src/routes/reviews.js`
- Create: `backend/src/controllers/reviewController.js`

---

## Issue #2: Backend - Collect Review Comments & Marks Endpoint

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process6-collect-reviews`

### Description
Create endpoint for committee members to submit review comments and section marks. Process 6.2 (Collect Review Comments &amp; Marks).

### Acceptance Criteria
- [ ] `POST /api/reviews/:reviewId/submit` endpoint accepts:
  - reviewId (from Issue #1)
  - Payload: `{ comments: string, marks: { section1: 0-100, section2: 0-100, ... }, feedback: string }`
  - Updates review: status='submitted', submittedAt=now(), marksSubmitted=true

- [ ] `GET /api/reviews/:reviewId` endpoint returns:
  - Current review details
  - Deliverable content linked
  - Previous submissions (if any)

- [ ] Validates:
  - Reviewer has permission (JWT userId matches assigned reviewer)
  - Marks in valid range (0-100 per section)
  - Comments not empty

- [ ] Updates D5 with submitted review data
- [ ] Records submission timestamp for deadline tracking

### Files
- Update: `backend/src/controllers/reviewController.js`

---

## Issue #3: Backend - Review Mark &amp; Section Logging Service

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process6-mark-sections`

### Description
Implement service to log and store section marks from reviews. Process 6.3 (Mark Sections &amp; Log Reviews).

### Acceptance Criteria
- [ ] Service `ReviewSectionService.logMarkSubmission()`:
  - Takes reviewId, sectionMarks object
  - Validates each section mark (0-100)
  - Calculates average across sections
  - Returns: `{ averageMark: 0-100, sections: {}, timestamp }`

- [ ] Service `ReviewSectionService.calculateDeliverableScore()`:
  - Takes deliverableId
  - Aggregates all review marks for that deliverable
  - Calculates weighted average (if weights configured)
  - Returns: `{ deliverableScore, reviewCount, allSubmitted: true/false }`

- [ ] Service `ReviewSectionService.checkReviewCompletion()`:
  - Checks if all assigned reviewers submitted marks
  - Returns: `{ complete: true/false, submittedCount, totalCount }`

- [ ] All mark submissions logged to audit trail
- [ ] No external dependencies (queries D5 data)

### Files
- Create: `backend/src/services/reviewSectionService.js`

---

## Issue #4: Backend - Deliverable Models & Schema Updates

**Priority:** 🔴 P0 - Critical | **Type:** Backend Infrastructure | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process6-review-models`

### Description
Create Review model and update Deliverable model with review tracking fields. Add database migration.

### Acceptance Criteria
- [ ] Review Mongoose model (`backend/src/models/Review.js`):
  - Fields: id, deliverableId, reviewerId, status (enum: assigned/submitted/approved), marks (object), comments, feedback, submittedAt, createdAt
  - Indexes: `{ deliverableId: 1 }`, `{ reviewerId: 1, status: 1 }`

- [ ] Update Deliverable model:
  - Add fields: reviews (array of reviewIds), overallScore, reviewStatus (all_submitted/partial/not_started)
  - Indexes: `{ overallScore: 1 }` for sorting

- [ ] Migration `backend/src/migrations/008_create_review_schema.js`:
  - Creates Review collection
  - Updates Deliverable collection with new fields

- [ ] Soft delete not needed (keep all reviews)

### Files
- Create: `backend/src/models/Review.js`
- Update: `backend/src/models/Deliverable.js`
- Create: `backend/src/migrations/008_create_review_schema.js`

---

## Issue #5: Backend - Review Clarification Request Service

**Priority:** 🟠 P1 - High | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process6-clarification`

### Description
Implement service to handle clarification requests between committee and students during review.

### Acceptance Criteria
- [ ] Service `ClarificationService.addClarificationRequest()`:
  - Takes: deliverableId, reviewerId, question
  - Creates request in D5 with status: 'pending'
  - Returns: `{ requestId, timestamp }`

- [ ] Service `ClarificationService.submitClarification()`:
  - Takes: clarificationId, answer (from student)
  - Updates status: 'answered'
  - Returns: `{ clarificationId, answeredAt }`

- [ ] Service `ClarificationService.getClarificationThread()`:
  - Returns all Q&A for a deliverable
  - Ordered by timestamp

- [ ] Email notifications:
  - Student gets clarification request
  - Reviewer gets clarification answer

- [ ] Records all interactions in D5

### Files
- Create: `backend/src/services/clarificationService.js`

---

## Issue #6: Backend - Review Status Tracking &amp; Notifications

**Priority:** 🟠 P1 - High | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process6-review-notifications`

### Description
Implement service to track review progress and send status notifications to stakeholders.

### Acceptance Criteria
- [ ] Service `ReviewNotificationService.notifyReviewCompleted()`:
  - Called when all reviews submitted for a deliverable
  - Notifies: Coordinator, all committee members, students
  - Email: "Review completed – Score: XX/100"

- [ ] Service `ReviewNotificationService.notifyReviewerAssigned()`:
  - Called when review assigned to committee member
  - Email: "You have been assigned to review deliverable #{id}"

- [ ] Service `ReviewNotificationService.notifyClarificationRequest()`:
  - Notifies student of clarification needed
  - Notifies reviewer when answer submitted

- [ ] Service `ReviewStatusService.getReviewStatus()`:
  - Returns: `{ status, completedCount, totalCount, estimatedCompletion }`

- [ ] All notifications logged to audit trail
- [ ] Retry logic on email failure (3 attempts)

### Files
- Create: `backend/src/services/reviewNotificationService.js`

---

## Issue #7: Frontend - Review Assignment List &amp; Dashboard

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process6-review-dashboard`

### Description
Create React page for coordinators to manage review assignments. Shows pending deliverables and assigned reviewers.

### Acceptance Criteria
- [ ] Component `frontend/src/pages/ReviewManagement.jsx`:
  - List of pending deliverables needing assignment
  - Shows: groupId, deliverableType, submittedAt, submitterName
  - Pagination: 20 per page

- [ ] Assignment UI:
  - Dropdown to select committee members
  - Button to assign selected members
  - Confirmation message on success

- [ ] View assigned reviews:
  - Shows current assignments
  - Status: pending/submitted/completed
  - Submitted marks (if available)

- [ ] Filters:
  - By deliverable type (midterm/final/report)
  - By review status
  - By date range

- [ ] Responsive, TailwindCSS styled
- [ ] Loading states for API calls

### Files
- Create: `frontend/src/pages/ReviewManagement.jsx`
- Create: `frontend/src/components/reviews/PendingDeliverablesList.jsx`
- Create: `frontend/src/components/reviews/ReviewAssignmentForm.jsx`

### Depends On
- Issues #1, #2 (API endpoints ready)

---

## Issue #8: Frontend - Committee Review Form Component

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process6-review-form`

### Description
Create React component for committee members to submit reviews with marks, comments, and feedback.

### Acceptance Criteria
- [ ] Component `frontend/src/components/reviews/ReviewSubmissionForm.jsx`:
  - Display deliverable content (read-only)
  - Section marks input (0-100 numeric) for each section
  - Comments textarea (rich text optional)
  - Feedback textarea
  - Submit button (disabled until all fields valid)

- [ ] Form validation:
  - Marks: 0-100, required
  - Comments: required, min 20 chars
  - Real-time validation feedback

- [ ] Form states:
  - Initial: empty, ready for input
  - Loading: submitting to API
  - Success: "Review submitted successfully"
  - Error: show error with retry option

- [ ] Clarification thread (from Issue #5):
  - Show previous Q&amp;A
  - Allow adding new questions

- [ ] Progress tracking:
  - Show how many reviewers submitted
  - Time until deadline

- [ ] Responsive, mobile-friendly
- [ ] Accessibility: proper labels, keyboard navigation

### Files
- Create: `frontend/src/components/reviews/ReviewSubmissionForm.jsx`
- Create: `frontend/src/components/reviews/ClarificationThread.jsx`

### Depends On
- Issues #1, #2 (API endpoints ready)

---

## Issue #9: Backend Testing - Review Assignment &amp; Collection Tests (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process6-assignment-tests`

### Description
Comprehensive tests for review assignment and mark collection endpoints.

### Acceptance Criteria
- [ ] Tests for Issue #1 (assignment endpoint):
  - Retrieve pending deliverables → list returned
  - Assign to valid committee members → success
  - Assign to invalid members → error
  - Duplicate assignment → prevented

- [ ] Tests for Issue #2 (collect reviews):
  - Submit review with valid marks (0-100) → success
  - Submit with invalid marks (negative/&gt;100) → error
  - Missing comments → error
  - Get review details → returns all info
  - Permission check: only assigned reviewer can submit

- [ ] Tests for Issue #3 (mark logging):
  - Log marks → calculates average correctly
  - Calculate deliverable score → aggregates all reviews
  - Check completion → returns correct counts

- [ ] Edge cases:
  - No reviewers assigned
  - All reviewers submit
  - Partial reviews submitted
  - Late submissions

- [ ] Minimum 80% code coverage
- [ ] Mock database for all tests

### Files
- Create: `backend/tests/deliverable-reviews.test.js`

### Depends On
- Issues #1, #2, #3 (code to test)

---

## Issue #10: Backend Testing - Clarification &amp; Notifications Tests (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process6-clarification-tests`

### Description
Comprehensive tests for clarification requests and notification services.

### Acceptance Criteria
- [ ] Clarification service tests (Issue #5):
  - Add clarification request → created with status='pending'
  - Submit answer → status changed to 'answered'
  - Get clarification thread → returns Q&amp;A in order
  - Cannot submit multiple answers
  - Permissions: only student can answer their question

- [ ] Notification tests (Issue #6):
  - Review completed notification → sent to all stakeholders
  - Reviewer assigned notification → sent to assigned person
  - Clarification request notification → sent to relevant parties
  - All notifications logged to audit

- [ ] Retry logic tests:
  - Email failure → retries 3 times
  - Success on retry → stops retrying
  - After 3 fails → logged without throwing

- [ ] Status tracking tests:
  - Get review status → correct counts
  - All submitted → completion detected
  - Partial → incomplete status

- [ ] Minimum 80% code coverage
- [ ] Mock email service and database

### Files
- Create: `backend/tests/review-clarification-notification.test.js`

### Depends On
- Issues #5, #6 (code to test)

---

## Issue #11: Frontend Testing - Review Management Page &amp; Assignment (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process6-management-tests`

### Description
Tests for review management dashboard and assignment form component.

### Acceptance Criteria
- [ ] Page rendering tests:
  - Review dashboard renders
  - Pending deliverables list visible
  - Assignment form visible

- [ ] List functionality:
  - API called to fetch deliverables
  - List displayed with correct columns
  - Pagination works (20 per page)
  - Filters work (by type, status, date)

- [ ] Assignment form:
  - Committee member dropdown appears
  - Selection updates state
  - Submit button calls API
  - Success message shown
  - Error handled with retry

- [ ] Status display:
  - Shows pending/submitted/completed correctly
  - Shows marks if available
  - Shows submission timestamps

- [ ] User interactions:
  - Click deliverable → shows details
  - Select reviewers → updates UI
  - Submit assignment → API called
  - Pagination clicks → fetches new data

- [ ] Accessibility: keyboard navigation, screen reader friendly

- [ ] Minimum 80% code coverage
- [ ] Mock API calls, loading states

### Files
- Create: `frontend/src/pages/__tests__/ReviewManagement.test.js`

### Depends On
- Issue #7 (component to test)

---

## Issue #12: Frontend Testing - Review Submission Form &amp; Clarification (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process6-submission-tests`

### Description
Tests for committee review form with marks, comments, and clarification thread.

### Acceptance Criteria
- [ ] Form rendering:
  - Deliverable content displayed (read-only)
  - Mark input fields present (one per section)
  - Comments textarea present
  - Feedback textarea present
  - Submit button present (initially disabled)

- [ ] Mark validation:
  - Accepts 0-100 numeric values
  - Rejects negative/&gt;100 with error
  - Error clears when valid value entered
  - Submit disabled until all marks valid

- [ ] Form submission:
  - Collects all data correctly
  - Calls POST API endpoint
  - Shows loading state while submitting
  - Shows success message on completion
  - Shows error message on failure with retry

- [ ] Clarification thread:
  - Displays previous Q&amp;A
  - Add new question button works
  - Shows new questions immediately
  - Shows answers when submitted

- [ ] Progress info:
  - Shows reviewer count: X/Y submitted
  - Shows deadline countdown
  - Shows estimated completion

- [ ] User interactions:
  - Typing in marks/comments → updates state
  - Clicking submit → API called
  - Clicking add question → form opens
  - Submitting answer → thread updates

- [ ] Accessibility: labels linked, keyboard navigable

- [ ] Minimum 80% code coverage
- [ ] Mock API calls

### Files
- Create: `frontend/src/components/reviews/__tests__/ReviewSubmissionForm.test.js`

### Depends On
- Issue #8 (component to test)

---

## Summary

| # | Title | Dev | Type | SP | Phase |
|---|-------|-----|------|-----|-------|
| 1 | Assignment Endpoint | FS-Dev1 | Backend | 8 | 1-4 |
| 2 | Collect Reviews Endpoint | FS-Dev1 | Backend | 8 | 1-4 |
| 3 | Mark &amp; Section Service | FS-Dev2 | Backend | 8 | 1-4 |
| 4 | Review Models &amp; Migration | FS-Dev2 | Backend | 8 | 1-4 |
| 5 | Clarification Service | Back-Dev | Backend | 8 | 1-4 |
| 6 | Notifications Service | Back-Dev | Backend | 8 | 1-4 |
| 7 | Review Management Page | Front-Dev | Frontend | 8 | 5-7 |
| 8 | Review Form Component | Front-Dev | Frontend | 8 | 5-7 |
| 9 | Assignment Tests | Back-Test | Testing | 8 | 8-10 |
| 10 | Clarification Tests | Back-Test | Testing | 8 | 8-10 |
| 11 | Management Tests | Front-Test | Testing | 8 | 8-10 |
| 12 | Submission Form Tests | Front-Test | Testing | 8 | 8-10 |

**Total: 96 SP | Per Dev: 16 SP | Coverage: 80%+ | Conflicts: 0%**
