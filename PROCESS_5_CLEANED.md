# Process 5 - GitHub Issues (Ready to Post)

---

## Issue #1: Backend - Group & Committee Validation Endpoint

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process5-validate-group`

### Description
Implement validation endpoint to check if group exists and has an assigned committee. This is Process 5.1 gate that must pass before deliverable upload.

### Acceptance Criteria
- [ ] `POST /api/deliverables/validate-group/:groupId` endpoint created
  - Requires JWT authentication
  - Returns 200: `{ status: 'valid', groupId, committeeCount }`
  - Returns 404 if group not found
  - Returns 403 if no committee assigned
  - Returns 401 if unauthorized

- [ ] Validates group exists in D2 with active status
- [ ] Confirms committee members from D3 are assigned
- [ ] All validation failures logged to audit trail
- [ ] Response time < 200ms (queries indexed)

### Files
- Create: `backend/src/routes/deliverables.js`
- Create: `backend/src/controllers/deliverableController.js`

---

## Issue #2: Backend - Deliverable Upload Endpoint & Model

**Priority:** 🔴 P0 - Critical | **Type:** Backend Feature | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 1 | **Branch:** `feature/process5-upload-endpoint`

### Description
Create endpoint to receive deliverable file uploads and create preliminary database records. Process 5.2 implementation.

### Acceptance Criteria
- [ ] `POST /api/deliverables/upload` endpoint accepts multipart/form-data with file + metadata
  - Metadata: groupId, deliverableType (enum), description
  - Returns 201: `{ deliverableId, status: 'pending_validation', uploadedAt }`
  - Returns 413 if file > 1GB

- [ ] Mongoose model `Deliverable` created with fields:
  - id, groupId, type (enum), submittedBy, description, filePath, fileSize, fileHash, status (enum), createdAt, updatedAt
  - Indexes: `{ groupId: 1, createdAt: -1 }`, `{ status: 1 }`

- [ ] Preliminary record created: status='pending_validation', submittedBy=userId
- [ ] File size pre-check (max 1GB)

### Files
- Create: `backend/src/models/Deliverable.js`
- Update: `backend/src/controllers/deliverableController.js`

---

## Issue #3: Backend - Format & File Size Validation Service

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process5-format-validation`

### Description
Implement file format and size validation logic (Process 5.3). Reusable service for other processes.

### Acceptance Criteria
- [ ] Function `validateFormat(fileBuffer, fileName, type)` checks:
  - Extension in [.pdf, .docx, .pptx, .zip]
  - MIME type using magic bytes (prevents spoofing)
  - Returns `{ valid: true/false, error?: string }`

- [ ] Function `validateFileSize(fileSize, type)` enforces:
  - midterm ≤ 100MB, final ≤ 500MB, report ≤ 250MB
  - Returns `{ withinLimit: true/false, maxAllowed?: number }`

- [ ] Magic bytes validation (PDF: 0x25504446, DOCX/ZIP: 0x504B0304)
- [ ] Pure utility functions, no external dependencies

### Files
- Create: `backend/src/services/deliverableValidationService.js`
- Create: `backend/src/utils/fileValidator.js`

---

## Issue #4: Backend - Requirements & Deadline Validation Service

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Full-Stack Developer 2 | **Branch:** `feature/process5-requirements-validation`

### Description
Implement business logic to validate team requirements and deadlines (Process 5.4).

### Acceptance Criteria
- [ ] Function `checkDeadline(groupId, type)` verifies:
  - Current time < deadline from D8
  - Returns `{ onTime: true, deadline: Date }` or `{ onTime: false, timeRemaining: ms }`

- [ ] Function `checkTeamRequirements(groupId)` verifies:
  - All team members from D2 have status 'confirmed' or 'joined'
  - Returns `{ requirementsMet: true/false, missingMembers?: [] }`

- [ ] Combined function `checkSubmissionEligibility(groupId, type)`:
  - Calls both checks above
  - Returns `{ eligible: true/false, reason?: string }`

- [ ] Clear error messages for each failure scenario

### Files
- Update: `backend/src/services/deliverableValidationService.js`

---

## Issue #5: Backend - File Storage Service & Database Migration

**Priority:** 🔴 P0 - Critical | **Type:** Backend Infrastructure | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process5-storage-service`

### Description
Implement permanent file storage and create database migration (Process 5.5).

### Acceptance Criteria
- [ ] Function `persistDeliverableFile(deliverableId, fileBuffer, metadata)`:
  - Saves to `uploads/deliverables/{groupId}/{deliverableId}.{ext}`
  - Generates SHA256 checksum
  - Returns `{ savedPath, fileSize, checksum, timestamp }`

- [ ] Function `createFinalRecord(deliverableId)`:
  - Sets status: 'submitted' (from 'pending_validation')
  - Records filePath, fileSize, fileHash, submittedAt

- [ ] Migration `backend/src/migrations/007_create_deliverable_schema.js`:
  - Creates Deliverable collection
  - Builds indexes: `{ groupId: 1, createdAt: -1 }`, `{ status: 1 }`

- [ ] Directory `uploads/deliverables/` auto-created

### Files
- Create: `backend/src/services/storageService.js`
- Create: `backend/src/migrations/007_create_deliverable_schema.js`

---

## Issue #6: Backend - Notification Service (Committee, Coordinator, Students)

**Priority:** 🔴 P0 - Critical | **Type:** Backend Service | **Story Points:** 8  
**Assigned To:** Backend Developer | **Branch:** `feature/process5-notifications`

### Description
Implement notification system to alert stakeholders on deliverable submission (Process 5.6).

### Acceptance Criteria
- [ ] Function `notifyCommittee(deliverableId, groupId)`:
  - Queries D3 for committee emails
  - Sends: "New Deliverable #{id} from [GroupName]"
  - Logs to audit trail

- [ ] Function `notifyCoordinator(deliverableId, groupId)`:
  - Queries D1 for coordinator/admin email
  - Sends: "Deliverable #{id} submitted by [GroupName]"

- [ ] Function `notifyStudents(deliverableId, groupId)`:
  - Queries D2 for team member emails
  - Sends receipt: "Deliverable received – ID #{id}, Time: [timestamp]"

- [ ] Email templates: `backend/src/templates/deliverable-*.txt` (3 files)
- [ ] Error resilience: 3 retry attempts on failure, doesn't block submission

### Files
- Create: `backend/src/services/notificationService.js`
- Create: `backend/src/templates/deliverable-committee.txt`
- Create: `backend/src/templates/deliverable-coordinator.txt`
- Create: `backend/src/templates/deliverable-student.txt`

---

## Issue #7: Frontend - Deliverable Submission Form Component

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process5-form-component`

### Description
Create React form for students to submit deliverables with type, description, and group validation.

### Acceptance Criteria
- [ ] Component `frontend/src/components/deliverables/DeliverableSubmissionForm.jsx`:
  - Type dropdown (midterm/final/report) - required
  - Description textarea (10-500 chars) - required
  - Submit button disabled until form valid

- [ ] Form validation with real-time feedback
- [ ] On submit: calls `POST /api/deliverables/validate-group/:groupId`
  - Valid (200) → renders FileUploadWidget below
  - Invalid (403/404) → shows error message
  - Network error → shows retry option

- [ ] Form states: initial, loading, success, error
- [ ] Responsive design, TailwindCSS styling
- [ ] Accessibility: labels linked, keyboard navigable, screen reader friendly

### Files
- Create: `frontend/src/components/deliverables/DeliverableSubmissionForm.jsx`

### Depends On
- Issue #1 (API endpoint ready)

---

## Issue #8: Frontend - File Upload Widget & API Integration

**Priority:** 🟠 P1 - High | **Type:** Frontend Feature | **Story Points:** 8  
**Assigned To:** Frontend Developer | **Branch:** `feature/process5-upload-widget`

### Description
Create drag-and-drop file upload component with progress tracking and error handling.

### Acceptance Criteria
- [ ] Component `frontend/src/components/deliverables/FileUploadWidget.jsx`:
  - Drag-and-drop area + click button
  - Shows file name and size once selected
  - Progress bar updates real-time (0-100%)

- [ ] Client-side format validation:
  - Accept: .pdf, .docx, .pptx, .zip
  - Error if invalid format or too large

- [ ] Upload flow:
  - Calls `POST /api/deliverables/upload` (multipart)
  - Sends: file + groupId + type + description
  - Shows progress during upload

- [ ] Success state:
  - "✅ Submission successful!"
  - Shows Deliverable ID and timestamp
  - "Done" button returns to dashboard

- [ ] Error states with retry:
  - Network error, file too large, format invalid, server error
  - Retry button available on error

- [ ] Cancel button stops upload, resets widget

### Files
- Create: `frontend/src/components/deliverables/FileUploadWidget.jsx`
- Create: `frontend/src/api/deliverableAPI.js`

### Depends On
- Issues #1-6 (backend APIs ready)

---

## Issue #9: Backend Testing - Validation Endpoints & Services (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process5-validation-tests`

### Description
Comprehensive unit and integration tests for validation endpoints and services.

### Acceptance Criteria
- [ ] Tests for Issue #1 endpoint:
  - Valid group + committee → 200
  - Invalid groupId → 404
  - Valid group, no committee → 403
  - No JWT → 401

- [ ] Tests for Issue #3 (format validation):
  - Valid PDF, DOCX, ZIP → pass
  - Invalid format, spoofed file → fail with error
  - Edge cases: empty file, special chars

- [ ] Tests for Issue #4 (requirements/deadline):
  - All team confirmed → pass
  - Member missing → fail with list
  - Before deadline → pass
  - After deadline → fail

- [ ] Minimum 80% code coverage
- [ ] All error scenarios covered (5+)
- [ ] Mock database for tests

### Files
- Create: `backend/tests/deliverable-validation.test.js`
- Create: `backend/tests/fixtures/deliverable-test-data.js`

### Depends On
- Issues #1, #3, #4 (code to test)

---

## Issue #10: Backend Testing - Storage & Notification Services (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Backend Testing | **Story Points:** 8  
**Assigned To:** Backend Tester | **Branch:** `feature/process5-storage-tests`

### Description
Comprehensive tests for file storage and notification services.

### Acceptance Criteria
- [ ] Storage service tests:
  - File persisted → exists on disk, checksum correct
  - Disk full scenario → error with message
  - Record created → correct DB fields

- [ ] Notification tests:
  - Committee notified → all members get email
  - Coordinator notified → single email
  - Students notified → all team members get receipt
  - Email templates render correctly
  - Notifications logged to audit

- [ ] Error resilience tests:
  - Email service failure → doesn't crash
  - Retry logic works → 3 attempts
  - Success after retry → stops retrying

- [ ] Minimum 80% code coverage
- [ ] Mock filesystem and email service

### Files
- Create: `backend/tests/deliverable-storage.test.js`

### Depends On
- Issues #5, #6 (code to test)

---

## Issue #11: Frontend Testing - Form Component (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process5-form-tests`

### Description
Unit tests for DeliverableSubmissionForm component with user interactions and API integration.

### Acceptance Criteria
- [ ] Rendering: form fields, labels, submit button (disabled initially)
- [ ] Validation: type required, description 10-500 chars, real-time feedback
- [ ] Form states: initial, loading, success, error
- [ ] API integration: calls validation endpoint, handles responses/errors
- [ ] User interactions: typing, selecting, clicking submit/retry
- [ ] Accessibility: keyboard navigation, error associations, screen reader
- [ ] Minimum 80% code coverage
- [ ] Mock API calls

### Files
- Create: `frontend/src/components/deliverables/__tests__/DeliverableSubmissionForm.test.js`

### Depends On
- Issue #7 (component to test)

---

## Issue #12: Frontend Testing - Upload Widget Component (80% coverage)

**Priority:** 🟡 P2 - Medium | **Type:** Frontend Testing | **Story Points:** 8  
**Assigned To:** Frontend Tester | **Branch:** `feature/process5-upload-tests`

### Description
Unit tests for FileUploadWidget with drag-drop, upload, progress, and error handling.

### Acceptance Criteria
- [ ] Rendering: drag area, button, progress bar
- [ ] File selection: click button, drag-drop, shows name/size
- [ ] Format validation: accepts valid, rejects invalid
- [ ] Size validation: under limit passes, over limit fails
- [ ] Upload flow: API called, progress updates, success message shown
- [ ] Error states: network, file too large, format invalid, server error + retry
- [ ] Cancel functionality: stops upload, resets widget
- [ ] Accessibility: keyboard accessible, progress announced
- [ ] Minimum 80% code coverage
- [ ] Mock API, file system, progress events

### Files
- Create: `frontend/src/components/deliverables/__tests__/FileUploadWidget.test.js`

### Depends On
- Issue #8 (component to test)

---

## Summary

| # | Title | Dev | Type | SP | Phase |
|---|-------|-----|------|-----|-------|
| 1 | Validation Endpoint | FS-Dev1 | Backend | 8 | 1-4 |
| 2 | Upload Endpoint & Model | FS-Dev1 | Backend | 8 | 1-4 |
| 3 | Format Validation | FS-Dev2 | Backend | 8 | 1-4 |
| 4 | Requirements Validation | FS-Dev2 | Backend | 8 | 1-4 |
| 5 | Storage & Migration | Back-Dev | Backend | 8 | 1-4 |
| 6 | Notifications | Back-Dev | Backend | 8 | 1-4 |
| 7 | Form Component | Front-Dev | Frontend | 8 | 5-7 |
| 8 | Upload Widget | Front-Dev | Frontend | 8 | 5-7 |
| 9 | Validation Tests | Back-Test | Testing | 8 | 8-10 |
| 10 | Storage Tests | Back-Test | Testing | 8 | 8-10 |
| 11 | Form Tests | Front-Test | Testing | 8 | 8-10 |
| 12 | Upload Tests | Front-Test | Testing | 8 | 8-10 |

**Total: 96 SP | Per Dev: 16 SP | Coverage: 80%+ | Conflicts: 0%**
