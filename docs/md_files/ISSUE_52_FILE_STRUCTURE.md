# Issue #52 Implementation — File Structure & Summary

## New Files Created

```
backend/
├── src/
│   ├── utils/
│   │   └── groupStatusEnum.js (NEW)
│   │       ├── GROUP_STATUS constants
│   │       ├── VALID_STATUS_TRANSITIONS state machine
│   │       └── INACTIVE_GROUP_STATUSES, ACTIVE_GROUP_STATUSES sets
│   │
│   ├── services/
│   │   └── groupStatusTransition.js (NEW)
│   │       ├── validateTransition()
│   │       ├── transitionGroupStatus()
│   │       ├── activateGroup()
│   │       ├── deactivateGroup()
│   │       ├── rejectGroup()
│   │       └── isGroupInactive()
│   │
│   └── controllers/
│       └── groupStatusTransition.js (NEW)
│           ├── transitionStatus() — PATCH endpoint
│           └── getStatus() — GET endpoint
```

## Modified Files

### `backend/src/routes/groups.js`

**Changes:**
- Added import of `groupStatusTransition` controller
- Added `GET /:groupId/status` route
- Added `PATCH /:groupId/status` route

### `backend/src/controllers/groups.js`

**Changes:**
- Added import of `INACTIVE_GROUP_STATUSES`
- Updated `createMemberRequest()` to validate group is not inactive

### `backend/src/controllers/groupMembers.js`

**Changes:**
- Added import of `INACTIVE_GROUP_STATUSES`
- Updated `addMember()` to validate group is not inactive

### `backend/src/services/groupService.js`

**Changes:**
- Added import of `activateGroup` from statusTransition service
- Exported `activateGroup` for use by validation/processing pipelines

### `backend/src/models/AuditLog.js`

**Changes:**
- Added `'status_transition'` action to enum (snake_case per spec)

## API Endpoints

### Status Transitions

```
GET    /api/v1/groups/:groupId/status
       └─ Retrieve current status and possible transitions
       └─ Permission: Any authenticated user

PATCH  /api/v1/groups/:groupId/status
       ├─ Transition group to new status
       ├─ Permission: Coordinator, Committee Member, Professor, Admin
       └─ Body: { status: string, reason: string }
```

### Member Operations (Updated)

```
POST   /api/v1/groups/:groupId/members
       └─ Now validates group is not inactive (409 if inactive)

POST   /api/v1/groups/:groupId/member-requests
       └─ Now validates group is not inactive (409 if inactive)
```

## State Transitions

```
pending_validation ──────────→ active
         │                        │
         └──────→ rejected ←──────┘
                      ↑
                      │
inactive ────────────→ active
   ↑                      │
   └──────────────────────┘
```

## Key Functions Exported

### From `utils/groupStatusEnum.js`
```javascript
GROUP_STATUS // { PENDING_VALIDATION, ACTIVE, INACTIVE, REJECTED }
VALID_STATUS_TRANSITIONS // State machine rules
ACTIVE_GROUP_STATUSES // Can receive members
INACTIVE_GROUP_STATUSES // Cannot receive members
```

### From `services/groupStatusTransition.js`
```javascript
validateTransition(currentStatus, targetStatus)
transitionGroupStatus(groupId, targetStatus, options)
activateGroup(groupId, options)
deactivateGroup(groupId, options)
rejectGroup(groupId, options)
isGroupInactive(groupOrGroupId)
```

### From `controllers/groupStatusTransition.js`
```javascript
transitionStatus(req, res) // PATCH endpoint handler
getStatus(req, res) // GET endpoint handler
```

## Database Considerations

### No Migrations Required
- Group model already has `status` field with correct enum
- AuditLog already has `groupId` index
- All required indexes exist

### Indexes Used
- `Group.status` — Efficient filtering of group status
- `AuditLog.groupId` + `action` — Efficient status transition audit queries
- `AuditLog.action` + `createdAt` — Efficient audit log queries

## Error Codes

| Code | Status | Condition |
|------|--------|-----------|
| `MISSING_STATUS` | 400 | Status field missing or invalid type |
| `MISSING_REASON` | 400 | Reason field missing or empty |
| `GROUP_NOT_FOUND` | 404 | Group ID doesn't exist |
| `FORBIDDEN` | 403 | User lacks required role |
| `INVALID_STATUS_TRANSITION` | 409 | Transition violates state machine |
| `GROUP_INACTIVE` | 409 | Cannot add members to inactive group |
| `SERVER_ERROR` | 500 | Unexpected server error |

## Integration Checklist

- [ ] All 5 new/modified files in place
- [ ] No syntax errors in any file
- [ ] All imports/requires correct
- [ ] State machine rules properly defined
- [ ] Audit logging implemented
- [ ] Permission checks in place
- [ ] Error handling implemented
- [ ] Documentation complete
- [ ] Test scenarios documented
- [ ] Ready for test implementation

## Rollback Instructions

If needed, these files can be removed/reverted:

1. Delete `backend/src/utils/groupStatusEnum.js`
2. Delete `backend/src/services/groupStatusTransition.js`
3. Delete `backend/src/controllers/groupStatusTransition.js`
4. Revert import in `backend/src/routes/groups.js`
5. Revert import and check in `backend/src/controllers/groups.js`
6. Revert import and check in `backend/src/controllers/groupMembers.js`
7. Revert export in `backend/src/services/groupService.js`
8. Revert AuditLog enum in `backend/src/models/AuditLog.js`

## Next Steps

1. **Write Tests** — Use scenarios in `ISSUE_52_TEST_SCENARIOS.md`
2. **Integration** — Call `activateGroup()` when validation completes
3. **Validation** — Run full test suite to ensure no regressions
4. **Documentation** — Update API specification with new endpoints
5. **Merge** — Create PR and merge to main branch

---

**All implementation files are self-contained and follow the existing codebase patterns.**
