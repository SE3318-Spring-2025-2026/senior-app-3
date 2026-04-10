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
Create endpoint to receive deliverable file uploads and create preliminary database records. Implements Process 5.2 (Receive Deliverable). File validation and storage happens in later issues.

### Acceptance Criteria
- [ ] Endpoint `POST /api/deliverables/upload` created
  - Accepts `multipart/form-data` with file + metadata
  - Metadata: `groupId`, `deliverableType` (enum), `description` 
  - Returns 201: `{ deliverableId, status: 'pending_validation', uploadedAt }`
  - Returns 400: `{ error: 'Missing required fields' }`
  - Returns 413: `{ error: 'File too large (max 1GB)' }`
  - Returns 401: `{ error: 'Unauthorized' }`

- [ ] Deliverable Mongoose model created (`backend/src/models/Deliverable.js`)
  - Fields: `id`, `groupId`, `type`, `submittedBy`, `description`, `filePath`, `fileSize`, `fileHash`, `status`, `createdAt`, `updatedAt`
  - Enums: `type` in [midterm, final, report], `status` in [pending_validation, validated, rejected, submitted]
  - Validation rules: `groupId` required, `type` required, `fileSize > 0`
  - Indexes: `{ groupId: 1, createdAt: -1 }`, `{ status: 1 }`

- [ ] Preliminary record created in database
  - `status: 'pending_validation'` (not yet validated)
  - `submittedBy: userId` from JWT token
  - `createdAt: now()` auto-generated

- [ ] File size pre-check
  - Check file Buffer length before database insert
  - Reject if > 1GB with clear error

### Technical Details
**Files to create:**
- `backend/src/models/Deliverable.js` (new)
- Update `backend/src/controllers/deliverableController.js` - add upload handler

**Configuration:**
- `MAX_FILE_SIZE = 1GB` (environment variable or hardcoded)

**Dependencies:**
- Multer middleware for file upload (likely already installed)
- Existing User model for submittedBy

**No file persistence yet** - just database record

### Branch
```
feature/process5-upload-endpoint
```

### Notes
- File is NOT saved to disk in this issue (happens in Issue #5)
- Status stays 'pending_validation' until later validations pass
- Work in same controller file as Issue #1
- Start immediately (Day 1)

---

## 🔴 ISSUE #3: Backend - Format & File Size Validation Service

**Assigned To:** Full-Stack Developer 2  
**Story Points:** 8  
**Priority:** P0 - Critical  
**Type:** Backend Service

### Description
Implement validation logic to check file format and size constraints. Creates reusable validation service for Process 5.3 (Validate Format & Size). Other endpoints will call this service.

### Acceptance Criteria
- [ ] Service file `backend/src/services/deliverableValidationService.js` created

- [ ] Function `validateFormat(fileBuffer, fileName, type)`
  - Params: file buffer, original filename, deliverable type
  - Validates file extension in [.pdf, .docx, .pptx, .zip]
  - Validates MIME type using file magic bytes (not extension alone)
  - Prevents spoofed files (.exe renamed to .pdf)
  - Returns: `{ valid: true, mimeType: '...' }` OR `{ valid: false, error: 'Invalid format' }`

- [ ] Function `validateFileSize(fileSize, type)`
  - Params: file size in bytes, deliverable type
  - Size limits: midterm ≤ 100MB, final ≤ 500MB, report ≤ 250MB
  - Returns: `{ withLimit: true }` OR `{ withinLimit: false, maxAllowed: 100, error: '...' }`

- [ ] All validation functions are testable
  - No external dependencies (no API calls)
  - Pure functions when possible
  - Clear error messages for debugging

- [ ] Magic bytes validator implemented
  - PDF: 0x25504446 signature check
  - DOCX: ZIP structure validation
  - ZIP: 0x504B0304 signature check
  - Prevents format spoofing attacks

### Technical Details
**Files to create:**
- `backend/src/services/deliverableValidationService.js` (new)
- `backend/src/utils/fileValidator.js` (new) - validator helper functions

**Constants in fileValidator.js:**
```javascript
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.zip'];
const FILE_SIZE_LIMITS = {
  midterm: 100 * 1024 * 1024,   // 100MB
  final: 500 * 1024 * 1024,     // 500MB
  report: 250 * 1024 * 1024     // 250MB
};
const MAGIC_BYTES = {
  pdf: 0x25504446,
  docx: 0x504B0304,
  zip: 0x504B0304
};
```

**No database queries needed**

### Branch
```
feature/process5-format-validation
```

### Notes
- Pure utility functions - highly reusable
- Will be called from other services
- Start immediately (Day 1) - no dependencies

---

## 🔴 ISSUE #4: Backend - Requirements & Deadline Validation Service

**Assigned To:** Full-Stack Developer 2  
**Story Points:** 8  
**Priority:** P0 - Critical  
**Type:** Backend Service

### Description
Implement business logic to validate team requirements and submission deadlines. Creates validation service for Process 5.4 (Check Requirements & Deadline).

### Acceptance Criteria
- [ ] Function `checkDeadline(groupId, type)` in deliverableValidationService
  - Query D8 (Rubrics & Sprint Configs) for deadline date
  - Compare current time vs deadline (timezone-aware, use UTC)
  - Returns: `{ onTime: true, deadline: Date }` OR `{ onTime: false, deadline: Date, timeRemaining: ms }`
  - Clear error: "Submission deadline was [date]"

- [ ] Function `checkTeamRequirements(groupId)`
  - Query D2 (Groups) for team members
  - Query D1 (Users) for each member's status
  - All members must have status 'confirmed' or 'joined'
  - Returns: `{ requirementsMet: true }` OR `{ requirementsMet: false, missingMembers: [{name, status}] }`

- [ ] Function `checkSubmissionEligibility(groupId, type)` - combines above
  - Calls both deadline and requirements checks
  - Returns unified result: `{ eligible: true }` OR `{ eligible: false, reason: 'Deadline passed' / 'Team incomplete' }`

- [ ] Helpful error messages
  - "Cannot submit – deadline was 2025-04-15"
  - "Cannot submit – [2] team members not yet confirmed"
  - "Submission deadline [date] in [X days]"

### Technical Details
**Files to update:**
- `backend/src/services/deliverableValidationService.js` - add new functions

**Database queries:**
- Group.findById(groupId) for team info
- User.findById(userId) for member status
- SprintConfig.findOne({ groupId }) for deadlines

**Indexes required:**
- Ensure Group model indexed on _id
- Ensure User model indexed on _id
- Deadline queries will be rare (acceptable)

### Branch
```
feature/process5-requirements-validation
```

### Notes
- Queries must be efficient (use .lean() for read-only)
- Timezone handling: assume all times in UTC
- Start immediately (Day 1)

---

## 🔴 ISSUE #5: Backend - File Storage Service & Database Migration

**Assigned To:** Backend Developer  
**Story Points:** 8  
**Priority:** P0 - Critical  
**Type:** Backend Infrastructure

### Description
Implement permanent file storage and create database migration. Process 5.5 (Store & Create Record) - files are persisted here.

### Acceptance Criteria
- [ ] Service `backend/src/services/storageService.js` created

- [ ] Function `persistDeliverableFile(deliverableId, fileBuffer, metadata)`
  - Save file to: `uploads/deliverables/{groupId}/{deliverableId}.{ext}`
  - Generate SHA256 checksum of file content
  - Returns: `{ savedPath, fileSize, checksum, timestamp }`
  - Handle disk full gracefully (throw descriptive error)

- [ ] Function `createFinalRecord(deliverableId)`
  - Update DB: set `status: 'submitted'` (from 'pending_validation')
  - Set `filePath`, `fileSize`, `fileHash` from storage
  - Set `submittedAt: now()`
  - Returns: `{ deliverableId, status: 'submitted' }`

- [ ] Database migration `backend/src/migrations/007_create_deliverable_schema.js`
  - Create Deliverable collection schema
  - Fields from model (Issue #2)
  - Creates indexes: `{ groupId: 1, createdAt: -1 }`, `{ status: 1 }`
  - Follows existing migration pattern in project

- [ ] Directory structure
  - `uploads/deliverables/` auto-created if missing
  - Proper file permissions (readable by app user only)

### Technical Details
**Files to create:**
- `backend/src/services/storageService.js` (new)
- `backend/src/migrations/007_create_deliverable_schema.js` (new)

**Environment variables:**
- `UPLOADS_DIR` = path (default: `./uploads`)

**No API endpoint** - this is a helper service

### Branch
```
feature/process5-storage-service
```

### Notes
- Local disk storage (not cloud yet)
- File checksum for integrity verification
- Migration runs before deployment
- Start immediately (Day 1)

---

## 🔴 ISSUE #6: Backend - Notification Service

**Assigned To:** Backend Developer  
**Story Points:** 8  
**Priority:** P0 - Critical  
**Type:** Backend Service

### Description
Implement notification system to alert Committee, Coordinator, and Students on submission. Process 5.6 (Notify Stakeholders).

### Acceptance Criteria
- [ ] Service `backend/src/services/notificationService.js` created

- [ ] Function `notifyCommittee(deliverableId, groupId)`
  - Query D3 (Committee Assignments) for committee member emails
  - Send email to each: "New Deliverable #{id} from [GroupName] – Review needed"
  - Log to audit trail
  - Returns: `{ notified: [emails], timestamp }`

- [ ] Function `notifyCoordinator(deliverableId, groupId)`
  - Query D1 (Admin user) email from Users collection
  - Send email: "Deliverable #{id} submitted by [GroupName]"
  - Log to audit trail
  - Returns: `{ notified: coordinatorEmail, timestamp }`

- [ ] Function `notifyStudents(deliverableId, groupId)`
  - Query D2 (Groups) for team member emails
  - Send receipt email: "Your deliverable received – ID #{id}, Time: [timestamp]"
  - Log to audit trail
  - Returns: `{ notified: [studentEmails], timestamp }`

- [ ] Email templates created (3 files)
  - `backend/src/templates/deliverable-committee.txt`
  - `backend/src/templates/deliverable-coordinator.txt`
  - `backend/src/templates/deliverable-student.txt`

- [ ] Error resilience
  - Email service failure doesn't crash submission
  - Retry logic: 3 attempts, exponential backoff
  - Failed notifications logged (not thrown)

### Technical Details
**Files to create:**
- `backend/src/services/notificationService.js` (new)
- `backend/src/templates/deliverable-*.txt` (3 new)

**Uses existing:**
- emailService (already exists)
- Audit logging middleware

**No database writes** - uses existing models for queries

### Branch
```
feature/process5-notifications
```

### Notes
- Notifications are async (fire-and-forget)
- Critical: don't let email failures block submission
- Retry automatically on failure
- Start immediately (Day 1)

---

## 🟠 ISSUE #7: Frontend - Deliverable Submission Form Component

**Assigned To:** Frontend Developer  
**Story Points:** 8  
**Priority:** P1 - High  
**Type:** Frontend Feature

### Description
Create React form component for students to submit deliverables. Handles type selection, description entry, and group validation.

### Acceptance Criteria
- [ ] Component file `frontend/src/components/deliverables/DeliverableSubmissionForm.jsx` created

- [ ] Form fields rendered
  - Deliverable type dropdown: [midterm, final, report] - required
  - Description textarea: min 10 chars, max 500 chars - required
  - Submit button - disabled until form valid

- [ ] Form validation
  - Type field required → show error if empty
  - Description required → error if < 10 or > 500 chars
  - Real-time validation feedback
  - Submit button disabled while any field invalid

- [ ] Form states
  - Initial: empty fields, submit disabled
  - Loading: spinner visible, inputs disabled
  - Success: "Group validated! Ready for file upload"
  - Error: show error message with retry option

- [ ] Group validation integration
  - On submit, calls `POST /api/deliverables/validate-group/:groupId`
  - Uses groupId from auth context
  - If valid (200) → render FileUploadWidget (Issue #8) below
  - If invalid (403/404) → show error, don't show upload widget

- [ ] Error handling
  - Network error → "Connection error – retry?"
  - 401 → "Session expired, please login again"
  - Other errors → generic message with retry button

- [ ] Styling
  - Responsive design (mobile, tablet, desktop)
  - Uses TailwindCSS (project standard)
  - Clear visual hierarchy

- [ ] Accessibility
  - Form labels linked to inputs (htmlFor)
  - Error messages associated with fields (aria-describedby)
  - Keyboard navigable (tab order correct)
  - Screen reader friendly

### Technical Details
**Files to create:**
- `frontend/src/components/deliverables/DeliverableSubmissionForm.jsx` (new)

**API calls:**
- Must call Issue #1 endpoint: `POST /api/deliverables/validate-group/:groupId`

**Dependencies:**
- React hooks (useState, useCallback)
- Auth context (get groupId)
- React Query or Axios for API calls

**No database access from frontend**

### Branch
```
feature/process5-form-component
```

### Notes
- Start Day 5 (wait for backend API endpoints ready)
- Use functional component with hooks
- No inline styles - use TailwindCSS only
- Test with keyboard navigation

---

## 🟠 ISSUE #8: Frontend - File Upload Widget & API Integration

**Assigned To:** Frontend Developer  
**Story Points:** 8  
**Priority:** P1 - High  
**Type:** Frontend Feature

### Description
Create drag-and-drop file upload widget. Integrates with backend upload endpoint and provides real-time progress feedback.

### Acceptance Criteria
- [ ] Component `frontend/src/components/deliverables/FileUploadWidget.jsx` created

- [ ] Drag & drop functionality
  - Drag-and-drop area with visual feedback (highlight on hover)
  - "Click to select" button alternative
  - Shows file name and size once selected

- [ ] Format validation (client-side)
  - Accept only: .pdf, .docx, .pptx, .zip
  - Show error if wrong: "Only PDF, DOCX, PPTX, ZIP allowed"
  - Show error if too large: "Max 100MB – your file is XXX MB"

- [ ] Upload flow
  - Calls `POST /api/deliverables/upload` (Issue #2 endpoint)
  - Sends file as multipart/form-data with groupId, type, description
  - Shows progress bar (0-100%)
  - Progress bar updates in real-time (not fake)

- [ ] Success state
  - Message: "✅ Submission successful!"
  - Shows: "Deliverable ID: #12345"
  - Shows: "Submitted at: [timestamp]"
  - "Done" button → navigate to dashboard

- [ ] Error states
  - Network error → "Connection error – retry?"
  - File too large → "File too large – try smaller file"
  - Invalid format → "File format not supported"
  - 413 error → "File exceeds server limit"
  - 500 error → "Server error – try again later"
  - Retry button always available on error

- [ ] Cancel functionality
  - Cancel button stops upload mid-process
  - Resets widget to initial state
  - Can re-select same file and retry

- [ ] Styling
  - Visual drag-over state (different color/border)
  - Nice progress bar (TailwindCSS)
  - Responsive to mobile
  - Clear success/error state colors

### Technical Details
**Files to create:**
- `frontend/src/components/deliverables/FileUploadWidget.jsx` (new)
- `frontend/src/api/deliverableAPI.js` (new) - API request wrapper

**API wrapper function:**
```javascript
uploadDeliverable(groupId, file, metadata)
// Returns promise with progress events
// Handles errors with retry logic
```

**No backend calls other than upload endpoint**

### Branch
```
feature/process5-upload-widget
```

### Notes
- Start Day 5 (wait for backend)
- Test with multiple file sizes
- Use FormData for multipart upload
- Actual progress, not fake percentage
- Mobile file picker compatible

---

## 🟡 ISSUE #9: Backend Testing - Validation Endpoints & Services (Comprehensive)

**Assigned To:** Backend Tester  
**Story Points:** 8  
**Priority:** P2 - Medium  
**Type:** Backend Testing

### Description
Comprehensive unit and integration tests for validation endpoints and services (Issues #1, #3, #4).

### Acceptance Criteria
- [ ] Endpoint tests (`POST /api/deliverables/validate-group`)
  - Valid group with committee → 200 status, valid response
  - Invalid groupId → 404
  - Valid group, no committee → 403
  - No JWT → 401
  - Invalid JWT → 401
  - Database error scenario → 500

- [ ] Format validation tests
  - Valid PDF file → `{ valid: true, mimeType: '...' }`
  - Valid DOCX, PPTX, ZIP → each passes independently
  - Invalid format (.exe, .jpg) → `{ valid: false, error: '...' }`
  - Spoofed file (.exe as .pdf) → rejected
  - Empty file buffer → handled gracefully

- [ ] Requirements validation tests
  - All team members confirmed → `{ requirementsMet: true }`
  - One member not confirmed → `{ requirementsMet: false, missingMembers: [...] }`
  - No team members → fails appropriately
  - Group doesn't exist → error response

- [ ] Deadline validation tests
  - Submission before deadline → `{ onTime: true }`
  - Submission after deadline → `{ onTime: false, error: '...' }`
  - Boundary condition (exactly on deadline) → correct behavior

- [ ] Combined eligibility tests
  - All checks pass → `{ eligible: true }`
  - Any fails → `{ eligible: false, reason: '...' }`
  - Multiple failures → most critical reason returned

### Technical Details
**Files to create:**
- `backend/tests/deliverable-validation.test.js` (new)
- `backend/tests/fixtures/deliverable-test-data.js` (updated)

**Test framework:** Jest (existing setup)

**Mocking:**
- Mock Group, User, Committee models
- Mock current time for deadline tests
- Use fixtures for test data

**Coverage requirement:** 80%+ code coverage for validation code

### Branch
```
feature/process5-validation-tests
```

### Notes
- Start Day 8 (backend code for testing ready)
- All test names descriptive
- Fast tests (< 100ms total)
- Happy paths + 5+ error scenarios per function

---

## 🟡 ISSUE #10: Backend Testing - Storage & Notification Services (Comprehensive)

**Assigned To:** Backend Tester  
**Story Points:** 8  
**Priority:** P2 - Medium  
**Type:** Backend Testing

### Description
Comprehensive tests for file storage and notification services (Issues #5, #6).

### Acceptance Criteria
- [ ] Storage service tests
  - Valid file persisted → file exists on disk, checksum recorded
  - File with special chars in name → saved correctly
  - Disk full scenario → throws error with message
  - Duplicate write (same ID) → overwrites or denies appropriately
  - Record created with correct fields → DB query confirms

- [ ] Notification tests
  - Committee notified → all members get email (by query count)
  - Coordinator notified → single email to correct person
  - Students notified → all team members get receipt
  - Email template rendered correctly → content verified
  - Notifications logged to audit → audit entry exists

- [ ] Error resilience
  - Email service failure → doesn't crash, logged
  - Retry logic works → 3 attempts when failed
  - Success after retry → stops retrying

### Technical Details
**Files to create:**
- `backend/tests/deliverable-storage.test.js` (new)

**Mocking:**
- Mock filesystem (fs module)
- Mock email service
- Mock database

**Coverage requirement:** 80%+ for storage & notification code

### Branch
```
feature/process5-storage-tests
```

### Notes
- Start Day 8
- Mock real I/O (don't write actual files)
- Mock email sends (don't send real emails)
- Tests should be fast

---

## 🟡 ISSUE #11: Frontend Testing - Form Component Tests

**Assigned To:** Frontend Tester  
**Story Points:** 8  
**Priority:** P2 - Medium  
**Type:** Frontend Testing

### Description
Comprehensive unit tests for DeliverableSubmissionForm component (Issue #7).

### Acceptance Criteria
- [ ] Component rendering tests
  - Type dropdown renders
  - Description textarea renders
  - Submit button renders (initially disabled)

- [ ] Form validation tests
  - Empty type → submit disabled, error shown
  - Description < 10 chars → error shown
  - Description > 500 chars → error shown
  - Valid form → submit enabled, no errors

- [ ] Form state tests
  - Initial state: empty, submit disabled
  - Loading state: spinner visible, inputs disabled
  - Success state: success message visible
  - Error state: error message with retry button

- [ ] API integration tests
  - On submit, calls correct endpoint
  - Valid response → FileUploadWidget rendered below
  - Invalid response (403) → error message shown
  - Network error → handled gracefully

- [ ] User interaction tests
  - Selecting type → updates state
  - Typing description → real-time validation
  - Clicking submit → API called
  - Clicking retry → tries again

- [ ] Accessibility tests
  - Keyboard navigation works (Tab)
  - Error messages linked to fields
  - Screen reader friendly

### Technical Details
**Files to create:**
- `frontend/src/components/deliverables/__tests__/DeliverableSubmissionForm.test.js` (new)

**Test framework:** Jest + React Testing Library

**Mocking:**
- Mock deliverableAPI module
- Mock auth context
- Mock child components

**Coverage requirement:** 80%+

### Branch
```
feature/process5-form-tests
```

### Notes
- Start Day 9 (component code ready)
- Use React Testing Library (test behavior, not implementation)
- No enzyme or other methods
- Test user interactions, not internal state

---

## 🟡 ISSUE #12: Frontend Testing - Upload Widget Component Tests

**Assigned To:** Frontend Tester  
**Story Points:** 8  
**Priority:** P2 - Medium  
**Type:** Frontend Testing

### Description
Comprehensive tests for FileUploadWidget component (Issue #8).

### Acceptance Criteria
- [ ] Widget rendering tests
  - Drag-and-drop area visible
  - Click button visible
  - Progress bar visible (initially 0%)

- [ ] File selection tests
  - Click button opens picker
  - File selected → shows name and size
  - Drag-and-drop → accepts file
  - Drag-over state → visual feedback

- [ ] Format validation tests (client)
  - Valid file (PDF) → passes
  - Invalid file (.exe) → error message
  - Multiple formats → each handled correctly

- [ ] File size validation tests
  - Under limit → passes
  - Over limit → error message
  - Size display correct (bytes to MB)

- [ ] Upload flow tests
  - API called on file select
  - Progress bar updates during upload
  - Progress shown (0%, 50%, 100%)
  - Cancel button stops upload

- [ ] Success state tests
  - Upload completes → success message shown
  - Deliverable ID displayed
  - Timestamp shown
  - "Done" button navigates away

- [ ] Error state tests
  - Network error → error message + retry
  - File too large → helpful message
  - Invalid format (backend) → shown to user
  - Server error → generic message + retry

- [ ] Accessibility tests
  - Drag area keyboard accessible
  - Progress announced to screen readers
  - Buttons keyboard navigable
  - Errors announced

### Technical Details
**Files to create:**
- `frontend/src/components/deliverables/__tests__/FileUploadWidget.test.js` (new)

**Mocking:**
- Mock deliverableAPI.uploadDeliverable()
- Mock File objects
- Mock progress events

**Coverage requirement:** 80%+

### Branch
```
feature/process5-upload-tests
```

### Notes
- Start Day 9
- Mock file I/O (no real uploads in tests)
- Simulate drag-and-drop events
- Test progress accurately
- All error paths tested

---

## 📊 Summary

**Total Issues:** 12  
**Per Developer:** 2 issues  
**Total Story Points:** ~96 SP  
**Per Developer:** ~16 SP (roughly 1.5-2 weeks)

### Team Distribution

| Developer | Issues | Type | SP |
|-----------|--------|------|-----|
| FS-Dev 1 | #1, #2 | Backend | 16 |
| FS-Dev 2 | #3, #4 | Backend | 16 |
| Backend Dev | #5, #6 | Backend | 16 |
| Frontend Dev | #7, #8 | Frontend | 16 |
| Backend Tester | #9, #10 | Testing | 16 |
| Frontend Tester | #11, #12 | Testing | 16 |

### Timeline

**Phase 1 (Days 1-4):** Issues #1-6 (Backend parallel)  
**Phase 2 (Days 5-7):** Issues #7-8 (Frontend sequential)  
**Phase 3 (Days 8-10):** Issues #9-12 (Testing parallel)  
**Phase 4 (Days 11-12):** Review & Deploy

### Merge Conflict Prevention

✅ Each developer has completely separate files  
✅ 16 new files, zero file overlap  
✅ No package.json modifications  
✅ No shared config files edited  

**Conflict risk:** 0%
