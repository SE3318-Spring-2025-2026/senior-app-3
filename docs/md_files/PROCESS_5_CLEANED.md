# Process 5 - GitHub Issues (Ready to Post)

---

## Issue #1: Backend - Multer & Auth Middleware Setup

**Priority:** 🔴 P0 - Critical | **Type:** Backend Infrastructure | **Story Points:** 5  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process5-middleware`

### Description
Set up shared middleware required by all Process 5 endpoints: multipart file upload parsing (multer) and JWT-based role authorization. Must be in place before any other Process 5 issue can be implemented.

### Acceptance Criteria
- [ ] Multer configured in `backend/src/middleware/upload.js`:
  - Max file size: 1GB (hard limit, returns 413 before hitting controller)
  - Storage: `diskStorage` to `uploads/staging/{stagingId}/`
  - Accepted mimetypes: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/markdown`, `application/zip`
  - Rejects other mimetypes with 415 before controller runs

- [ ] Auth middleware in `backend/src/middleware/auth.js`:
  - Validates Bearer JWT on every `/api/deliverables/*` route
  - Attaches `req.user = { userId, role, groupId }` on success
  - Returns 401 if token missing or invalid
  - Accepted roles for submission routes: `student`
  - Accepted roles for retract route: `coordinator`

- [ ] Both middleware exported and wired into `backend/src/routes/deliverables.js`

### Files
- Create: `backend/src/middleware/upload.js`
- Create/Update: `backend/src/middleware/auth.js`
- Create: `backend/src/routes/deliverables.js`

---

## Issue #2: Backend - Group & Committee Validation Endpoint

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process5-validate-group`

### Description
Implement the first gate of the submission pipeline (Process 5.1): check that the requesting student's group exists in D2 with active status AND has at least one committee member assigned in D3. Returns a short-lived `validationToken` that must be passed to the upload endpoint (Issue #3).

### Acceptance Criteria
- [ ] `POST /api/deliverables/validate-group` endpoint:
  - Requires JWT (`student` role, via auth middleware from Issue #1)
  - Request body: `{ groupId: string }`
  - `groupId` in body must match `req.user.groupId` — return 403 if mismatch

- [ ] Validation logic:
  - Query D2 (Groups collection): group must exist AND `status === 'active'`. Return 404 if not found, 409 if found but inactive/suspended
  - Query D3 (CommitteeAssignments collection): at least one committee member must be assigned to this group. Return 409 with `{ code: 'NO_COMMITTEE_ASSIGNED' }` if none found

- [ ] On success, return 200:
  ```json
  {
    "groupId": "grp_2024_001",
    "committeeId": "cmt_2024_001",
    "groupStatus": "active",
    "advisorId": "adv_prof_smith",
    "validationToken": "<signed JWT, expires in 15 min>",
    "validAt": "<ISO timestamp>"
  }
  ```
  - `validationToken` is a JWT signed with the server secret, payload: `{ groupId, committeeId, exp: now+15min }`

- [ ] All validation failures (404, 409, 403) logged to audit trail with `userId`, `groupId`, `reason`, `timestamp`
- [ ] Response time < 200ms (queries use indexed fields)

### Files
- Create: `backend/src/routes/deliverables.js`
- Create: `backend/src/controllers/deliverableController.js`

### Depends On
- Issue #1 (auth middleware)

---

## Issue #3: Backend - Deliverable Upload Endpoint & Staging Record

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process5-upload-endpoint`

### Description
Implement Process 5.2: accept the deliverable file and create a **staging** (temporary) database record. This is NOT the final submission record — it enters a validation pipeline (Issues #4, #5, #6) before being permanently stored. Returns a `stagingId` used by subsequent pipeline steps.

### Acceptance Criteria
- [ ] `POST /api/deliverables/submit` endpoint:
  - Requires JWT (`student` role)
  - Accepts `multipart/form-data` via multer middleware (Issue #1)
  - Request fields: `groupId`, `deliverableType` (enum), `sprintId`, `description` (optional), `file` (binary)
  - Validates `validationToken` from Issue #2 is present in `Authorization-Validation` header and not expired — return 403 if missing or expired
  - `groupId` must match token's `groupId` — return 403 if mismatch

- [ ] `deliverableType` enum: `[proposal, statement_of_work, demo, interim_report, final_report]`

- [ ] On success, create a **staging record** (not a Deliverable) with:
  - `stagingId` (generated UUID)
  - `groupId`, `deliverableType`, `sprintId`, `submittedBy` (userId)
  - `tempFilePath` (where multer saved it)
  - `fileSize` (bytes), `fileHash` (SHA256 of uploaded buffer)
  - `mimeType` (from multer)
  - `status: 'staging'`
  - `expiresAt`: now + 1 hour (staging records auto-expire if pipeline stalls)

- [ ] Return 202 (Accepted — file is staged, not yet permanent):
  ```json
  {
    "stagingId": "stg_5e8a9c2f1b",
    "fileHash": "abc123...",
    "sizeMb": 2.5,
    "mimeType": "application/pdf",
    "nextStep": "format_validation"
  }
  ```
  - Return 413 if file > 1GB (handled by multer middleware before controller)
  - Return 415 if file type not accepted (handled by multer middleware)
  - Return 429 if same group submits more than 3 times in 10 minutes

- [ ] Mongoose model `DeliverableStaging` created with all fields above
  - Index: `{ stagingId: 1 }` (unique), `{ expiresAt: 1 }` (TTL index, auto-delete expired staging records)

### Files
- Create: `backend/src/models/DeliverableStaging.js`
- Update: `backend/src/controllers/deliverableController.js`
- Update: `backend/src/routes/deliverables.js`

### Depends On
- Issues #1, #2

---

## Issue #4: Backend - Format & File Size Validation Service

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process5-format-validation`

### Description
Implement Process 5.3: validate the staged file's format and size. Called by the controller after upload (Issue #3). Updates the staging record status on success/failure.

### Acceptance Criteria
- [ ] `POST /api/deliverables/:stagingId/validate-format` endpoint:
  - Requires JWT (`student` role)
  - Looks up staging record by `stagingId` — return 404 if not found or expired
  - Calls `validateFormat()` and `validateFileSize()` (see below)
  - On failure: update staging `status = 'validation_failed'`, return 400 with error details, trigger async notification to student (flow f13)
  - On success: update staging `status = 'format_validated'`, return 200

- [ ] Function `validateFormat(filePath, mimeType, deliverableType)`:
  - Accepted extensions: `.pdf`, `.docx`, `.md`, `.zip`
  - Validates MIME type using magic bytes (not just extension):
    - PDF: magic bytes `0x25504446`
    - DOCX/ZIP: magic bytes `0x504B0304`
    - Markdown: text/plain check
  - Returns `{ valid: boolean, error?: string }`

- [ ] Function `validateFileSize(fileSizeBytes, deliverableType)`:
  - `proposal` ≤ 50MB, `statement_of_work` ≤ 50MB, `demo` ≤ 500MB, `interim_report` ≤ 100MB, `final_report` ≤ 500MB
  - Returns `{ withinLimit: boolean, maxAllowedMb?: number }`

- [ ] Success response 200:
  ```json
  {
    "stagingId": "stg_5e8a9c2f1b",
    "valid": true,
    "format": "pdf",
    "checks": { "formatValid": true, "sizeValid": true, "virusScanPassed": null },
    "nextStep": "deadline_validation"
  }
  ```

### Files
- Create: `backend/src/services/deliverableValidationService.js`
- Create: `backend/src/utils/fileValidator.js`
- Update: `backend/src/controllers/deliverableController.js`
- Update: `backend/src/routes/deliverables.js`

### Depends On
- Issue #3 (staging record must exist)

---

## Issue #5: Backend - Requirements & Deadline Validation Service

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process5-requirements-validation`

### Description
Implement Process 5.4: validate that the submission is within deadline and the group meets team requirements. Reads deadline and requirements from D8 (Rubrics & Sprint Configurations). Called after format validation passes.

### Acceptance Criteria
- [ ] `POST /api/deliverables/:stagingId/validate-deadline` endpoint:
  - Requires JWT (`student` role)
  - Request body: `{ sprintId: string }`
  - Looks up staging record — return 404 if not found or not in `format_validated` status
  - Calls `checkDeadline()` and `checkTeamRequirements()` (see below)
  - On failure: update staging `status = 'deadline_failed'`, return 400/403, trigger async notification
  - On success: update staging `status = 'requirements_validated'`, return 200

- [ ] Function `checkDeadline(sprintId, deliverableType)`:
  - Queries D8 (SprintConfig collection) for deadline by `sprintId` + `deliverableType`
  - Compares `Date.now()` vs deadline
  - Returns `{ onTime: boolean, deadline: Date, timeRemainingMinutes?: number }`
  - Return 403 with `{ code: 'DEADLINE_EXCEEDED' }` if past deadline

- [ ] Function `checkTeamRequirements(groupId)`:
  - Queries D2 for all members of the group
  - All members must have `status` of `'confirmed'` or `'joined'`
  - Returns `{ requirementsMet: boolean, missingMembers?: [{ userId, status }] }`

- [ ] Function `checkSubmissionEligibility(stagingId, sprintId)`:
  - Calls both checks above
  - Also checks version: how many prior submissions exist in D4 for same `groupId + deliverableType + sprintId`
  - Returns `{ eligible: boolean, submissionVersion: number, reason?: string }`

- [ ] Success response 200:
  ```json
  {
    "stagingId": "stg_5e8a9c2f1b",
    "deadlineOk": true,
    "sprintDeadline": "<ISO>",
    "timeRemainingMinutes": 120,
    "submissionVersion": 1,
    "priorSubmissions": 0,
    "readyForStorage": true
  }
  ```

### Files
- Update: `backend/src/services/deliverableValidationService.js`
- Update: `backend/src/controllers/deliverableController.js`
- Update: `backend/src/routes/deliverables.js`

### Depends On
- Issue #4 (staging must be in `format_validated` status)

---

## Issue #6: Backend - File Storage Service & Permanent Record

**Priority:** 🔴 P0 - Critical | **Type:** Backend Infrastructure | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process5-storage-service`

### Description
Implement Process 5.5: move the staged file to permanent storage, create the final `Deliverable` record in D4, and clean up the staging record. This is the point of no return — after this step the submission is permanent.

### Acceptance Criteria
- [ ] `POST /api/deliverables/:stagingId/store` endpoint:
  - Requires JWT (`student` role)
  - Looks up staging record — return 404 if not found, 400 if not in `requirements_validated` status
  - Calls `persistDeliverableFile()` then `createFinalRecord()` in a transaction
  - On success: deletes staging record, returns 201
  - On storage failure: staging record stays intact so user can retry; return 507 if disk full

- [ ] Function `persistDeliverableFile(stagingId, groupId, deliverableType)`:
  - Moves file from `uploads/staging/{stagingId}/` to `uploads/deliverables/{groupId}/{deliverableId}.{ext}`
  - Verifies SHA256 checksum matches the one stored in staging record
  - Creates `uploads/deliverables/{groupId}/` directory if it doesn't exist
  - Returns `{ savedPath, fileSize, checksum, timestamp }`

- [ ] Function `createFinalRecord(stagingRecord, savedPath)`:
  - Creates `Deliverable` document (see model below)
  - `status: 'accepted'`
  - Returns the created document

- [ ] Mongoose model `Deliverable` with fields:
  - `deliverableId` (UUID), `groupId`, `deliverableType` (enum: `[proposal, statement_of_work, demo, interim_report, final_report]`), `sprintId`
  - `submittedBy` (userId), `description`
  - `filePath`, `fileSize`, `fileHash`, `format`
  - `status` (enum: `[accepted, under_review, awaiting_resubmission, evaluated, retracted]`)
  - `version` (integer, from eligibility check in Issue #5)
  - `submittedAt`, `createdAt`, `updatedAt`
  - Indexes: `{ groupId: 1, createdAt: -1 }`, `{ status: 1 }`, `{ groupId: 1, deliverableType: 1, sprintId: 1 }`

- [ ] Migration `backend/src/migrations/007_create_deliverable_schema.js`:
  - Creates `Deliverable` and `DeliverableStaging` collections with all indexes above

- [ ] Success response 201:
  ```json
  {
    "deliverableId": "del_5e8f9d2a3c",
    "groupId": "grp_2024_001",
    "deliverableType": "interim_report",
    "status": "accepted",
    "fileHash": "abc123...",
    "sizeMb": 2.5,
    "format": "pdf",
    "version": 1,
    "submittedAt": "<ISO>"
  }
  ```

### Files
- Create: `backend/src/services/storageService.js`
- Create: `backend/src/models/Deliverable.js`
- Create: `backend/src/migrations/007_create_deliverable_schema.js`
- Update: `backend/src/controllers/deliverableController.js`

### Depends On
- Issues #3, #5

---

## Issue #7: Backend - Notification Service

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process5-notifications`

### Description
Implement Process 5.6: after permanent storage succeeds (Issue #6), asynchronously notify all stakeholders. Also handles failure notifications from earlier pipeline steps (format/deadline failures).

### Acceptance Criteria
- [ ] `POST /api/deliverables/:deliverableId/notify` endpoint:
  - Requires JWT
  - Looks up Deliverable — return 404 if not found
  - Return 409 if notifications already sent (`notifiedAt` field is set)
  - Queues all notifications and returns 202 immediately (does not wait for delivery)

- [ ] Uses **Nodemailer** with SMTP config from env vars:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — loaded via `process.env`
  - Email client instantiated once in `notificationService.js`, reused across calls

- [ ] Function `notifyCommittee(deliverableId, groupId)`:
  - Queries D3 for committee member emails assigned to this group
  - Sends using template `deliverable-committee.txt`: `"New Deliverable #{{id}} from {{groupName}} is ready for review"`
  - Logs each send to audit trail

- [ ] Function `notifyCoordinator(deliverableId, groupId)`:
  - Queries D1 for coordinator/admin email
  - Sends using template `deliverable-coordinator.txt`: `"Deliverable #{{id}} submitted by {{groupName}}"`

- [ ] Function `notifyStudents(deliverableId, groupId)`:
  - Queries D2 for team member emails
  - Sends using template `deliverable-student.txt`: `"Submission received — ID #{{id}}, Time: {{timestamp}}"`

- [ ] Retry logic: each send attempt retried up to **3 times** with **exponential backoff** (1s, 2s, 4s) using a simple recursive retry wrapper — no external queue library required
- [ ] Notification failures must **not** block or roll back the submission — log failure and move on
- [ ] Response 202:
  ```json
  {
    "deliverableId": "del_5e8f9d2a3c",
    "tasksQueued": 4,
    "estimatedDeliveryMinutes": 5
  }
  ```

### Files
- Create: `backend/src/services/notificationService.js`
- Create: `backend/src/templates/deliverable-committee.txt`
- Create: `backend/src/templates/deliverable-coordinator.txt`
- Create: `backend/src/templates/deliverable-student.txt`
- Update: `backend/src/controllers/deliverableController.js`

### Depends On
- Issue #6 (deliverable must exist)

---

## Issue #8: Backend - List & Detail Endpoints

**Priority:** 🟠 P1 - High | **Type:** Backend Feature | **Story Points:** 5  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process5-read-endpoints`

### Description
Implement read endpoints for deliverables — needed by the frontend dashboard and upload widget to display submission history and status.

### Acceptance Criteria
- [ ] `GET /api/deliverables` — list deliverables for a group:
  - Requires JWT
  - Query params: `groupId` (required for coordinator; defaults to `req.user.groupId` for student), `sprintId` (optional), `status` (optional), `page` (default 1), `limit` (default 20, max 100)
  - Students can only query their own group's deliverables — return 403 otherwise
  - Response 200: paginated list with `{ groupId, total, page, limit, deliverables: [DeliverableSummary] }`
  - Each summary: `deliverableId`, `deliverableType`, `sprintId`, `status`, `submittedAt`, `version`

- [ ] `GET /api/deliverables/:deliverableId` — get full details:
  - Requires JWT
  - Returns full `Deliverable` record plus `validationHistory` array (format_validation, deadline_validation, storage steps with `passed`, `checkedAt`, `errors`)
  - Student can only view deliverables belonging to their group — return 403 otherwise

- [ ] `DELETE /api/deliverables/:deliverableId` — retract submission:
  - Requires JWT (`coordinator` role only — return 403 for students)
  - Only allowed if `status === 'accepted'` (not yet under review) — return 409 if review has started
  - Sets `status = 'retracted'`, does **not** delete the file from disk
  - Response 200: `{ deliverableId, status: 'retracted' }`

### Files
- Update: `backend/src/controllers/deliverableController.js`
- Update: `backend/src/routes/deliverables.js`

### Depends On
- Issue #6 (Deliverable model must exist)

---

## Issue #9: Frontend - Deliverable Submission Form Component

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process5-form-component`

### Description
Create the React form component for students to initiate a deliverable submission. Lives at `/dashboard/submit-deliverable`. Calls the group validation endpoint (Issue #2) on submit, then renders the FileUploadWidget (Issue #10) on success.

### Acceptance Criteria
- [ ] Component `frontend/src/components/deliverables/DeliverableSubmissionForm.jsx`:
  - Type dropdown (enum: `proposal`, `statement_of_work`, `demo`, `interim_report`, `final_report`) — required
  - Sprint ID input — required
  - Description textarea (10–500 chars) — optional
  - Submit button disabled until type and sprintId are filled

- [ ] On submit: calls `POST /api/deliverables/validate-group` with `{ groupId }` (from auth context)
  - 200 → stores returned `validationToken` in component state, renders `<FileUploadWidget>` below, passing `validationToken`, `deliverableType`, `sprintId`, `description`
  - 403/404/409 → shows specific error message matching response `code` field
  - Network error → shows retry button

- [ ] Form states: `initial`, `loading`, `token_received` (shows widget), `error`
- [ ] Responsive design, TailwindCSS styling
- [ ] Accessibility: labels linked to inputs, keyboard navigable, error messages associated via `aria-describedby`

### Files
- Create: `frontend/src/components/deliverables/DeliverableSubmissionForm.jsx`
- Create: `frontend/src/pages/SubmitDeliverablePage.jsx` (wraps the form, handles routing)

### Depends On
- Issue #2 (API endpoint ready)

---

## Issue #10: Frontend - File Upload Widget & Pipeline Integration

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process5-upload-widget`

### Description
Create the file upload component that drives the full 4-step submission pipeline (5.2 → 5.3 → 5.4 → 5.5) sequentially, showing the user progress through each stage. Rendered by `DeliverableSubmissionForm` after group validation passes.

### Acceptance Criteria
- [ ] Component `frontend/src/components/deliverables/FileUploadWidget.jsx`:
  - Props: `validationToken`, `groupId`, `deliverableType`, `sprintId`, `description`
  - Drag-and-drop area + click-to-browse button
  - Accepted file types: `.pdf`, `.docx`, `.md`, `.zip`
  - Client-side size check: warn if > 500MB, hard block if > 1GB

- [ ] Pipeline execution (sequential, one step must succeed before the next):
  1. `POST /api/deliverables/submit` (multipart) → get `stagingId`. Show "Uploading..." with progress bar
  2. `POST /api/deliverables/:stagingId/validate-format` → show "Validating format..."
  3. `POST /api/deliverables/:stagingId/validate-deadline` with `{ sprintId }` → show "Checking deadline..."
  4. `POST /api/deliverables/:stagingId/store` → show "Saving submission..."

- [ ] Pipeline step display: stepper UI showing current step, completed steps (checkmark), and failed step (red X)

- [ ] Success state (after step 4):
  - Shows "Submission successful!"
  - Displays `deliverableId`, `submittedAt`, `version`
  - "View submission" button navigates to `/dashboard/deliverables/:deliverableId`

- [ ] Error handling per step:
  - Each step shows specific error from API response `code` field
  - "Retry" button re-attempts the failed step (not the whole pipeline)
  - "Cancel" button (available until step 4 completes) aborts and resets widget

- [ ] API calls abstracted in `frontend/src/api/deliverableAPI.js`:
  - `submitDeliverable(formData, validationToken)`
  - `validateFormat(stagingId, token)`
  - `validateDeadline(stagingId, sprintId, token)`
  - `storeDeliverable(stagingId, token)`

### Files
- Create: `frontend/src/components/deliverables/FileUploadWidget.jsx`
- Create: `frontend/src/api/deliverableAPI.js`

### Depends On
- Issues #2–#6 (all backend pipeline endpoints ready)
- Issue #9 (form passes props to this widget)

---

## Issue #11: Backend Testing - Validation Endpoints & Services (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process5-validation-tests`

### Description
Comprehensive unit and integration tests for Issues #2, #4, #5 (group validation, format validation, deadline validation).

### Acceptance Criteria
- [ ] Tests for Issue #2 (`validate-group`):
  - Active group + committee assigned → 200 with `validationToken`
  - Group not found → 404
  - Group inactive → 409
  - No committee assigned → 409 with `NO_COMMITTEE_ASSIGNED`
  - `groupId` mismatch with JWT → 403
  - No JWT → 401

- [ ] Tests for Issue #4 (format validation):
  - Valid PDF with correct magic bytes → pass
  - Valid DOCX → pass
  - Extension `.pdf` but wrong magic bytes (spoofed) → fail
  - File exceeds size limit for type → fail
  - Staging record not found → 404
  - Staging record in wrong status → 400

- [ ] Tests for Issue #5 (deadline validation):
  - All team members confirmed + before deadline → eligible
  - Past deadline → 403 `DEADLINE_EXCEEDED`
  - Member missing/unconfirmed → fail with `missingMembers` list
  - Sprint not found in D8 → 404
  - Staging record not in `format_validated` status → 400

- [ ] Minimum 80% code coverage
- [ ] Use mock database (jest + mongoose-memory-server)

### Files
- Create: `backend/tests/deliverable-validation.test.js`
- Create: `backend/tests/fixtures/deliverable-test-data.js`

### Depends On
- Issues #2, #4, #5

---

## Issue #12: Backend Testing - Storage & Notification Services (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process5-storage-tests`

### Description
Comprehensive tests for Issues #6 and #7 (storage service and notification service).

### Acceptance Criteria
- [ ] Storage service tests:
  - File moved from staging path to permanent path correctly
  - SHA256 checksum verified — mismatch returns error
  - `Deliverable` document created with correct fields and `status: 'accepted'`
  - Staging record deleted after successful store
  - Disk full scenario → 507, staging record untouched
  - Staging record in wrong status → 400

- [ ] Notification service tests:
  - Committee notified → email sent to all committee members in D3
  - Coordinator notified → single email sent
  - Students notified → all group members in D2 receive receipt
  - Email templates render with correct variable substitution
  - Email failure → submission not rolled back, failure logged
  - Retry logic → retries up to 3 times with backoff, stops on success
  - Already notified → 409

- [ ] Minimum 80% code coverage
- [ ] Mock filesystem (`mock-fs`) and mock Nodemailer transport

### Files
- Create: `backend/tests/deliverable-storage.test.js`
- Create: `backend/tests/deliverable-notifications.test.js`

### Depends On
- Issues #6, #7

---

## Issue #13: Frontend Testing - Form Component (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process5-form-tests`

### Description
Unit tests for `DeliverableSubmissionForm` (Issue #9).

### Acceptance Criteria
- [ ] Rendering: all fields, labels, submit button disabled initially
- [ ] Validation: type required, sprintId required, description 10–500 chars (if provided)
- [ ] Submit calls `POST /api/deliverables/validate-group` with correct body
- [ ] 200 → `validationToken` stored in state, `FileUploadWidget` rendered with correct props
- [ ] 403/404/409 → correct error message shown per `code` field
- [ ] Network error → retry button shown
- [ ] Form states: `initial`, `loading`, `token_received`, `error`
- [ ] Accessibility: keyboard navigable, errors linked via `aria-describedby`
- [ ] Minimum 80% code coverage
- [ ] Mock API calls with Jest

### Files
- Create: `frontend/src/components/deliverables/__tests__/DeliverableSubmissionForm.test.js`

### Depends On
- Issue #9

---

## Issue #14: Frontend Testing - Upload Widget Component (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process5-upload-tests`

### Description
Unit tests for `FileUploadWidget` (Issue #10), covering the full 4-step pipeline flow.

### Acceptance Criteria
- [ ] Rendering: drag area, file browser button, stepper with 4 steps
- [ ] File selection: click and drag-drop both work, shows filename and size
- [ ] Client-side validation: blocks files > 1GB, rejects invalid extensions
- [ ] Pipeline step 1 (upload): API called with correct multipart body + `validationToken`, progress bar updates
- [ ] Pipeline step 2 (format): called after step 1 success, "Validating format..." shown
- [ ] Pipeline step 3 (deadline): called after step 2 success, `sprintId` passed
- [ ] Pipeline step 4 (store): called after step 3 success, success state shown with `deliverableId`
- [ ] Error at any step: correct error message from `code` field, retry button only retries that step
- [ ] Cancel: aborts current step, resets widget to initial state
- [ ] Minimum 80% code coverage
- [ ] Mock all 4 API functions from `deliverableAPI.js`

### Files
- Create: `frontend/src/components/deliverables/__tests__/FileUploadWidget.test.js`

### Depends On
- Issue #10

---

## Summary

| # | Title | Dev | Type | SP | Phase |
|---|-------|-----|------|-----|-------|
| 1 | Multer & Auth Middleware | FS-Dev1 | Backend Infra | 5 | 1 |
| 2 | Group Validation Endpoint | FS-Dev1 | Backend | 8 | 1-2 |
| 3 | Upload Endpoint & Staging Model | FS-Dev1 | Backend | 8 | 2-3 |
| 4 | Format Validation Service | FS-Dev2 | Backend | 8 | 3-4 |
| 5 | Deadline & Requirements Validation | FS-Dev2 | Backend | 8 | 4-5 |
| 6 | Storage Service & Deliverable Model | Back-Dev | Backend | 8 | 5-6 |
| 7 | Notification Service | Back-Dev | Backend | 8 | 6-7 |
| 8 | List, Detail & Retract Endpoints | FS-Dev1 | Backend | 5 | 6-7 |
| 9 | Form Component | Front-Dev | Frontend | 8 | 7-8 |
| 10 | Upload Widget & Pipeline Integration | Front-Dev | Frontend | 8 | 8-9 |
| 11 | Validation Tests | Back-Test | Testing | 8 | 9-10 |
| 12 | Storage & Notification Tests | Back-Test | Testing | 8 | 9-10 |
| 13 | Form Tests | Front-Test | Testing | 8 | 10 |
| 14 | Upload Widget Tests | Front-Test | Testing | 8 | 10 |

**Total: 106 SP | Pipeline: fully sequential (1→2→3→4→5→6→7) | Coverage: 80%+ | Conflicts: 0%**

### Pipeline Flow (for reference)
```
Student submits form
  → Issue #2: validate-group → returns validationToken
  → Issue #3: /submit (multipart) → returns stagingId [status: staging]
  → Issue #4: /:stagingId/validate-format → [status: format_validated]
  → Issue #5: /:stagingId/validate-deadline → [status: requirements_validated]
  → Issue #6: /:stagingId/store → creates Deliverable [status: accepted]
  → Issue #7: /:deliverableId/notify → async notifications sent
```
