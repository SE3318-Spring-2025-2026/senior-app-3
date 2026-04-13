# Architecture Presentation — Process 3.0 & 4.0

> **Audience:** Stakeholders, faculty, and onboarding engineers  
> **Scope:** Level 2.3 (Group–Advisor Association, *Process 3.0*) and Level 2.4 (Committee Assignment & Deliverables, *Process 4.0*)  
> **Companion data-flow labels:** D2 (Groups), D3 (Committees), D4 (Deliverables), D6 (Sprint records)

---

## 1. 🚀 Executive Summary

**Process 3.0 (Advisor Association)** governs how a student-led team requests a faculty advisor, how the professor accepts or rejects that request within schedule windows, how a coordinator may **transfer** an advisor assignment, and how the system **sanitizes** groups that remain without an advisor after deadlines—keeping the **D2** group record, advisor status, and optional **AdvisorRequest** documents aligned with audit and notification expectations.

**Process 4.0 (Committee Assignment & Deliverables)** extends the lifecycle into formal evaluation structures: coordinators **draft** committees in **D3**, assign **advisors** and **jury** members, run **validation**, then **publish**—atomically linking published committees to **D2** groups. Students then **submit deliverables** into **D4** with storage references and timestamps, while **D6** sprint records capture committee assignment and **deliverable cross-references** for traceability across sprints.

Together, these epics close the loop from “team seeks mentor” to “committee-backed evaluation and artifact submission,” with explicit state machines, HTTP APIs, and persistence layers that match the domain language used in requirements and tests.

---

## 2. ⚙️ Core Workflows & Functions

### Process 3.0 (Advisor Association)

1. **Team leader request** — A student (typically the leader) submits an advisor association request against an open **advisor association** schedule window. The flow is exposed under `POST /api/v1/advisor-requests` and backed by `AdvisorRequest` persistence plus updates to the group’s embedded advisor request state where applicable.
2. **Professor decision** — The assigned professor reviews **pending** requests (`GET` variants under `/api/v1/advisor-requests`) and **approves** or **rejects** via `PATCH /api/v1/advisor-requests/:requestId`, which updates request status and synchronizes **D2** advisor fields (`advisorId`, `advisorStatus`, timestamps).
3. **Coordinator transfer** — If policy allows, a coordinator moves an advisor from one group to another using `POST /api/v1/groups/:groupId/advisor/transfer`, preserving operational windows and audit semantics.
4. **Disband sanitization** — After the advisor association window has ended, coordinators (or elevated roles) may invoke `POST /api/v1/groups/advisor-sanitization` to clean up groups that never secured an advisor—preventing stale “pending” cohorts from blocking downstream processes.

### Process 4.0 (Committee Assignment)

1. **Coordinator drafts committee** — `POST /api/v1/committees` creates a **D3** document in `draft` with a **globally unique** `committeeName` (enforced in schema and migrations).
2. **Assigns advisors / jury** — `POST /api/v1/committees/:committeeId/advisors` and `POST /api/v1/committees/:committeeId/jury` populate `advisorIds` and `juryIds` while the committee remains editable.
3. **Validation** — `POST /api/v1/committees/:committeeId/validate` promotes the committee to `validated` when business rules pass (`committeeValidationService` + controller orchestration).
4. **Publish** — `POST /api/v1/committees/:committeeId/publish` runs **`committeePublishService.publishCommitteeWithTransaction`**: a **MongoDB session** wraps **D3** publication and **D2** `committeeId` / `committeePublishedAt` updates plus audit entries; **notifications** run **after** commit.
5. **Student deliverable submission** — `POST /api/v1/groups/:groupId/deliverables` accepts `committeeId`, `sprintId`, `type`, and `storageRef`. **`deliverableService`** writes **D4**, updates **D6** (`deliverableRefs`, committee linkage), and validates that the group is tied to a **published** committee.

---

## 3. 📂 Codebase Mapping (Where is the Code?)

The table below maps **implemented** UI modules, HTTP surfaces, and services to **repository paths that exist today**. (Route modules are wired from `backend/src/index.js`; production handlers for committees live in `backend/src/controllers/committees.js`, not legacy alternate controllers.)

### Frontend — components, API clients, and tests

| Area | Repository files |
|------|------------------|
| **Advisor association UX** | `frontend/src/components/AdvisorAssociationPanel.js`, `frontend/src/components/AdvisorAssociationPanel.css`, `frontend/src/components/AdviseeRequestForm.js`, `frontend/src/components/AdviseeRequestForm.css`, `frontend/src/components/ProfessorInbox.js`, `frontend/src/components/ProfessorInbox.css` |
| **Group dashboard & store** | `frontend/src/components/GroupDashboard.js`, `frontend/src/components/GroupDashboard.css`, `frontend/src/store/groupStore.js` |
| **Committee management & jury** | `frontend/src/components/CommitteeCreationForm.js`, `frontend/src/components/CommitteeCreationForm.css`, `frontend/src/components/CommitteeManagementTab.js`, `frontend/src/components/CommitteeStatusCard.js`, `frontend/src/components/JuryCommittees.js` |
| **Deliverables** | `frontend/src/components/DeliverableSubmissionForm.js` |
| **API layer** | `frontend/src/api/advisorAssociationService.js`, `frontend/src/api/advisorService.js`, `frontend/src/api/committeeService.js`, `frontend/src/api/deliverableService.js`, `frontend/src/api/groupService.js` |
| **Representative tests** | `frontend/src/__tests__/AdvisorAssociationFlow.test.js`, `frontend/src/__tests__/CommitteeE2EFlow.test.js`, `frontend/src/__tests__/CommitteeManagementTab.test.js`, `frontend/src/__tests__/DeliverableSubmissionForm.test.js`, `frontend/src/__tests__/ProfessorInbox.test.js`, `frontend/src/components/__tests__/AdvisorAssociationPanel.test.js` |

### Backend — routes, controllers, and middleware

| Area | Repository files |
|------|------------------|
| **Advisor requests (Process 3.0)** | `backend/src/routes/advisorRequests.js` → `backend/src/controllers/advisorAssociation.js` (`submitAdvisorRequest`, `processAdvisorRequest`, professor listings) |
| **Groups: transfer, release, deliverables, sanitization** | `backend/src/routes/groups.js` → `backend/src/controllers/groups.js` (`transferAdvisor`), `backend/src/controllers/advisorAssociation.js` (`releaseAdvisor`), `backend/src/controllers/deliverables.js` (`submitDeliverableHandler`), `backend/src/controllers/sanitizationController.js` (`advisorSanitization`) |
| **Committees (Process 4.0)** | `backend/src/routes/committees.js` → `backend/src/controllers/committees.js` (`createCommitteeHandler`, `assignAdvisorsHandler`, `assignJuryHandler`, `validateCommitteeHandler`, `publishCommitteeHandler`, `getCommitteeHandler`, `getGroupCommitteeStatus`) |
| **Cross-cutting** | `backend/src/middleware/auth.js`, `backend/src/middleware/authorization.js`, `backend/src/middleware/scheduleWindow.js`, `backend/src/utils/operationTypes.js` |

### Backend — core services

| Concern | Repository files |
|--------|------------------|
| **Transactional committee publish (D3 + D2 + audit)** | `backend/src/services/committeePublishService.js` (`publishCommitteeWithTransaction` — `session.withTransaction`) |
| **Committee CRUD & validation** | `backend/src/services/committeeService.js`, `backend/src/services/committeeValidationService.js` |
| **Deliverables & D6 linkage** | `backend/src/services/deliverableService.js`, `backend/src/services/d6UpdateService.js` |
| **Advisor domain logic** | `backend/src/services/advisorRequestService.js`, `backend/src/services/advisorAssignmentService.js`, `backend/src/services/advisorService.js`, `backend/src/repositories/AdvisorAssignmentRepository.js` |
| **Sanitization** | `backend/src/services/sanitizationService.js` |
| **Notifications & resilience** | `backend/src/services/notificationService.js` (e.g. `dispatchCommitteePublishNotification`, committee publish path), `backend/src/services/notificationRetry.js` (**exponential backoff** via `retryNotificationWithBackoff`, transient error classification), `backend/src/services/committeeNotificationService.js`, `backend/src/services/adviseeNotificationService.js`, `backend/src/services/emailService.js` |
| **Audit trail** | `backend/src/services/auditService.js` |

### Backend — migrations & CLI

| Concern | Repository files |
|--------|------------------|
| **Migration registry & runner** | `backend/migrations/index.js`, `backend/migrations/migrationRunner.js`, `backend/src/migrate.js` |
| **Example two-phase migration (D3)** | `backend/migrations/008_create_committee_schema.js` (Phase 1: collection + validator; Phase 2: **idempotent** `createIndexSafely`) |

### Backend — integration / contract tests (supertest)

| Suite | Repository files |
|-------|------------------|
| **Committee flows + transactions** | `backend/tests/committee-integration.test.js` (**`supertest`** + **`MongoMemoryReplSet`** for `withTransaction`), `backend/tests/committee-notification.test.js` |
| **Advisor association & notifications** | `backend/tests/advisor-notification-integration.test.js` (**`supertest`**; notification module mocked), `backend/tests/advisor-association.test.js`, `backend/tests/advisor-association-d2-state.test.js` |

---

## 4. 🗄️ Database Architecture (Data Stores)

### D2 — `Group` (`backend/src/models/Group.js`)

Stores the **canonical group** document: membership, lifecycle `status`, GitHub/Jira integration fields, and **advisor association** state including `advisorId`, `advisorStatus`, `advisorRequest` (embedded sub-document), `advisorRequestId`, `advisorUpdatedAt`, `advisorAssignedAt`. For Process 4.0, it holds **`committeeId`** and **`committeePublishedAt`** once a committee is published and groups are linked—this is what **deliverable submission** checks before accepting **D4** writes.

### D3 — `Committee` (`backend/src/models/Committee.js`)

Represents the **committee entity**: unique `committeeId` and **`committeeName`**, `description`, **`advisorIds`** / **`juryIds`**, and lifecycle **`status`** in `draft` → `validated` → `published`, with `validatedAt` / `validatedBy` and `publishedAt` / `publishedBy` maintained through hooks and services.

### D4 — `Deliverable` (`backend/src/models/Deliverable.js`)

Stores each submission: `deliverableId`, **`committeeId`**, **`groupId`**, **`studentId`**, **`type`** (`proposal` \| `statement-of-work` \| `demonstration`), **`submittedAt`**, **`storageRef`** (artifact locator), review metadata (`status`, `feedback`, `reviewedBy`, `reviewedAt`), plus compound indexes for common lookups.

### D6 — `SprintRecord` (`backend/src/models/SprintRecord.js`)

Provides **sprint-level** continuity: `sprintRecordId`, `sprintId`, `groupId`, optional **`committeeId`** / `committeeAssignedAt`, **`deliverableRefs`** (embedded list of `{ deliverableId, type, submittedAt }`), and `status`. This is the **atomic cross-reference** layer between sprint work and deliverable artifacts—updated when deliverables are submitted or when committee assignment flows touch sprints (`d6UpdateService`).

### Additional persistence

- **`AdvisorRequest`** (`backend/src/models/AdvisorRequest.js`) — standalone request documents keyed by `requestId`, indexed by `groupId` / `professorId`, supporting the professor inbox workflow alongside embedded group state.

---

## 5. 🛡️ Enterprise-Grade Reliability & QA

### Graceful degradation (notifications vs. data integrity)

**`committeePublishService.js`** completes the **MongoDB transaction** (D3 publish, D2 group linkage, audit records) **before** outbound notification work. **`notificationService.dispatchCommitteePublishNotification`** uses **`notificationRetry.retryNotificationWithBackoff`** (configured backoff steps, transient vs. permanent error handling, optional **`SyncErrorLog`** persistence in the retry layer) so that **notification failures do not roll back committed database state** and do not present as spurious **503**-class API failures for the publish operation itself—aligning with the “fix notification after commit” pattern documented in the service.

### Idempotent migrations (two-phase pattern)

Migrations are **ordered** in `backend/migrations/index.js` and tracked in MongoDB via `backend/migrations/migrationRunner.js` (the `_migration` / `MigrationLog` pattern). Individual migrations—e.g. **`008_create_committee_schema.js`**—split **collection creation** (Phase 1) from **index creation** (Phase 2) using **`createIndexSafely`**, tolerating **“already exists”** errors so indexes can be reapplied safely in multiple environments.

### Comprehensive testing (TDD-oriented integration)

The backend favors **HTTP-level integration tests** with **`supertest`** against the exported Express `app` (`backend/src/index.js`), exercising real routing, auth middleware, and schedule windows where applicable. **Transaction-heavy paths** (committee publish) are covered with **`mongodb-memory-server`’s `MongoMemoryReplSet`** in suites such as **`committee-integration.test.js`** and **`committee-notification.test.js`**, providing a replica-set-capable MongoDB for **`session.withTransaction`**. Advisor flows and notification contracts are covered in **`advisor-notification-integration.test.js`** and related advisor association tests, often combining **real persistence** with **mocked** notification transports to keep tests deterministic—consistent with a **test-driven, contract-first** delivery style.

---

*Document generated from the current repository layout and modules verified present under `frontend/` and `backend/`. When you add new HTTP surfaces, extend Section 3 to match imports in `backend/src/index.js` and the frontend router.*
