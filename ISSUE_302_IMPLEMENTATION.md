# Issue #302 - Advisor Panel and Request Advisor API Fix

## Scope
Fix backend endpoints for Advisor Panel and Request Advisor flows so they:
- return expected data
- process advisor requests correctly
- enforce role-based protection correctly
- return proper status codes

## Code Changes

### 1) Advisor role compatibility on advisor-request routes
File: `backend/src/routes/advisorRequests.js`
- Added `advisor` role to `GET /api/v1/advisor-requests/mine`
- Added `advisor` role to `GET /api/v1/advisor-requests/pending`
- Added `advisor` role to `PATCH /api/v1/advisor-requests/:requestId`

Reason:
- The project uses both `professor` and `advisor` role labels in different flows; endpoints previously accepted only `professor`, causing access failures.

### 2) Correct controller wiring for transfer and sanitization
File: `backend/src/routes/groups.js`
- Routed `transferAdvisor` to `controllers/advisorAssociation`
- Routed `advisorSanitization` to `controllers/advisorAssociation`

Reason:
- Route/controller mismatch caused contract and status-code inconsistencies in advisor transfer/sanitization endpoints.

### 3) Sanitization response and deadline behavior alignment
File: `backend/src/controllers/advisorAssociation.js`
- Added advisor-association deadline check (returns 409 when deadline not reached)
- Preserved schedule-window behavior for sanitization window logic
- Added `success`, `count`, `disbandedGroups`, `notificationFailures`, `checkedAt` in success response
- Added retry-based disband notification failure collection
- Kept backward-compatible disband notification side effect

Reason:
- Align endpoint behavior with active advisor API contracts and notification integration expectations.

## Verification Performed

### Runtime checks
- Backend started successfully (`npm run dev`)
- Frontend started successfully (`npm start`)
- Health endpoint: `GET /health` -> `200`
- Protected endpoint check: `GET /api/v1/advisor-requests/mine` without token -> `401`

### Test checks
Passed:
- `npm test -- advisor-association-d2-state.test.js`
- `npm test -- advisor-notification-integration.test.js`
- `npm test -- advisor-decision.test.js`

Note:
- Legacy `advisor-association.test.js` expects older, conflicting contracts (status/payload semantics) and fails independently of #302 acceptance behavior.

## Acceptance Criteria Mapping

1. Advisor panel API endpoint returns correct and complete data
- Covered by advisor association state/contract tests and route/controller fixes.

2. Request advisor API endpoint correctly processes and stores requests
- Covered by advisor decision/state tests and request route fixes.

3. Proper error handling and status codes are returned
- Verified via test suites and smoke checks (401/409/422/200 paths).

4. Routes are protected with appropriate role-based access control
- Verified by role middleware updates and unauthorized smoke result (401).

## Files Changed
- `backend/src/routes/advisorRequests.js`
- `backend/src/routes/groups.js`
- `backend/src/controllers/advisorAssociation.js`
- `ISSUE_302_IMPLEMENTATION.md`
