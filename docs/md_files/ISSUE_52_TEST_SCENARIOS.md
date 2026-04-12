# Issue #52 Test Examples & Verification Checklist

## Test Scenarios

### 1. Status Transition Validation

#### Test Case: Valid Transitions
```javascript
// pending_validation → active
const validation = validateTransition('pending_validation', 'active');
assert(validation.isValid === true);

// active → inactive
const validation2 = validateTransition('active', 'inactive');
assert(validation2.isValid === true);

// inactive → active
const validation3 = validateTransition('inactive', 'active');
assert(validation3.isValid === true);
```

#### Test Case: Invalid Transitions
```javascript
// rejected → active (terminal state)
const validation = validateTransition('rejected', 'active');
assert(validation.isValid === false);
assert(validation.reason.includes('Allowed: none'));

// pending_validation → inactive (not allowed)
const validation2 = validateTransition('pending_validation', 'inactive');
assert(validation2.isValid === false);

// Same status transition
const validation3 = validateTransition('active', 'active');
assert(validation3.isValid === false);
assert(validation3.reason.includes('same as current status'));
```

### 2. PATCH /api/v1/groups/:groupId/status Endpoint

#### Test Case: Successful Status Transition
```javascript
const response = await request(app)
  .patch('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${coordinatorToken}`)
  .send({
    status: 'active',
    reason: 'Validation completed successfully'
  });

assert(response.status === 200);
assert(response.body.previous_status === 'pending_validation');
assert(response.body.new_status === 'active');
assert(response.body.reason === 'Validation completed successfully');
assert(response.body.timestamp);
```

#### Test Case: Permission Denied
```javascript
const response = await request(app)
  .patch('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${studentToken}`)
  .send({
    status: 'active',
    reason: 'Test'
  });

assert(response.status === 403);
assert(response.body.code === 'FORBIDDEN');
```

#### Test Case: Invalid Transition
```javascript
const response = await request(app)
  .patch('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${coordinatorToken}`)
  .send({
    status: 'inactive',  // Cannot: rejected → inactive
    reason: 'Test'
  });

// Group must be in 'rejected' status for this test
assert(response.status === 409);
assert(response.body.code === 'INVALID_STATUS_TRANSITION');
assert(response.body.current_status === 'rejected');
assert(response.body.attempted_status === 'inactive');
assert(response.body.allowed_transitions.length === 0);
```

#### Test Case: Missing Required Fields
```javascript
// Missing reason
const response = await request(app)
  .patch('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${coordinatorToken}`)
  .send({ status: 'active' });

assert(response.status === 400);
assert(response.body.code === 'MISSING_REASON');

// Missing status
const response2 = await request(app)
  .patch('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${coordinatorToken}`)
  .send({ reason: 'Test' });

assert(response2.status === 400);
assert(response2.body.code === 'MISSING_STATUS');
```

#### Test Case: Group Not Found
```javascript
const response = await request(app)
  .patch('/api/v1/groups/nonexistent/status')
  .set('Authorization', `Bearer ${coordinatorToken}`)
  .send({
    status: 'active',
    reason: 'Test'
  });

assert(response.status === 404);
assert(response.body.code === 'GROUP_NOT_FOUND');
```

### 3. GET /api/v1/groups/:groupId/status Endpoint

#### Test Case: Retrieve Current Status
```javascript
const response = await request(app)
  .get('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${studentToken}`);

assert(response.status === 200);
assert(response.body.groupId === 'grp_123');
assert(response.body.current_status === 'active');
assert(Array.isArray(response.body.possible_transitions));
assert(response.body.possible_transitions.includes('inactive'));
```

#### Test Case: Transitions from Each Status
```javascript
// pending_validation status
let group = await Group.findOneAndUpdate(
  { groupId: 'grp_test1' },
  { status: 'pending_validation' },
  { new: true }
);
const resp1 = await request(app).get('/api/v1/groups/grp_test1/status');
assert(JSON.stringify(resp1.body.possible_transitions.sort()) === 
       JSON.stringify(['active', 'rejected'].sort()));

// active status
group = await Group.findOneAndUpdate(
  { groupId: 'grp_test2' },
  { status: 'active' },
  { new: true }
);
const resp2 = await request(app).get('/api/v1/groups/grp_test2/status');
assert(JSON.stringify(resp2.body.possible_transitions.sort()) === 
       JSON.stringify(['inactive', 'rejected'].sort()));

// rejected status (terminal)
group = await Group.findOneAndUpdate(
  { groupId: 'grp_test3' },
  { status: 'rejected' },
  { new: true }
);
const resp3 = await request(app).get('/api/v1/groups/grp_test3/status');
assert(resp3.body.possible_transitions.length === 0);
```

### 4. Inactive Group Restrictions

#### Test Case: Cannot Request to Join Inactive Group
```javascript
// Create group and set to inactive
const group = await Group.create({
  groupName: 'Test Group',
  leaderId: 'usr_leader',
  status: 'inactive'
});

const response = await request(app)
  .post(`/api/v1/groups/${group.groupId}/member-requests`)
  .set('Authorization', `Bearer ${studentToken}`);

assert(response.status === 409);
assert(response.body.code === 'GROUP_INACTIVE');
assert(response.body.current_status === 'inactive');
```

#### Test Case: Cannot Add Members to Pending Validation Group
```javascript
const response = await request(app)
  .post('/api/v1/groups/grp_pending/members')
  .set('Authorization', `Bearer ${leaderToken}`)
  .send({ student_ids: ['student1', 'student2'] });

// Note: Group status is pending_validation
assert(response.status === 409);
assert(response.body.code === 'GROUP_INACTIVE');
assert(response.body.current_status === 'pending_validation');
```

#### Test Case: Cannot Add Members to Rejected Group
```javascript
const response = await request(app)
  .post('/api/v1/groups/grp_rejected/members')
  .set('Authorization', `Bearer ${leaderToken}`)
  .send({ student_ids: ['student1'] });

assert(response.status === 409);
assert(response.body.code === 'GROUP_INACTIVE');
assert(response.body.current_status === 'rejected');
```

#### Test Case: Can Add Members to Active Group
```javascript
const group = await Group.findOneAndUpdate(
  { groupId: 'grp_active' },
  { status: 'active' },
  { new: true }
);

const response = await request(app)
  .post(`/api/v1/groups/${group.groupId}/members`)
  .set('Authorization', `Bearer ${leaderToken}`)
  .send({ student_ids: ['valid_student_id'] });

// Should succeed (or fail for other reasons, not status)
assert(response.status !== 409 || response.body.code !== 'GROUP_INACTIVE');
```

### 5. Audit Logging

#### Test Case: Status Transition Audit Log Created
```javascript
const countBefore = await AuditLog.countDocuments({
  action: 'status_transition',
  groupId: 'grp_123'
});

const response = await request(app)
  .patch('/api/v1/groups/grp_123/status')
  .set('Authorization', `Bearer ${coordinatorToken}`)
  .send({
    status: 'active',
    reason: 'Test transition'
  });

assert(response.status === 200);

const countAfter = await AuditLog.countDocuments({
  action: 'status_transition',
  groupId: 'grp_123'
});

assert(countAfter === countBefore + 1);

const auditLog = await AuditLog.findOne({
  action: 'status_transition',
  groupId: 'grp_123'
}, { sort: { createdAt: -1 } });

assert(auditLog.payload.previous_status === 'pending_validation');
assert(auditLog.payload.new_status === 'active');
assert(auditLog.payload.reason === 'Test transition');
assert(auditLog.actorId === coordinatorId);
```

#### Test Case: Audit Log Contains IP and User Agent
```javascript
const auditLog = await AuditLog.findOne({
  action: 'status_transition',
  groupId: 'grp_123'
}, { sort: { createdAt: -1 } });

assert(auditLog.ipAddress);
assert(auditLog.userAgent);
```

### 6. Coordinator Override vs Direct Endpoint

#### Test Case: Coordinator Override Creates Additional Log
```javascript
// When using PATCH /groups/:groupId/status with coordinator role,
// creates status_transition log. If via override action, also creates coordinator_override log.

const logs = await AuditLog.find({
  groupId: 'grp_123',
  createdAt: { $gte: new Date(Date.now() - 10000) }
});

const statusLogs = logs.filter(l => l.action === 'status_transition');
const coordLogs = logs.filter(l => l.action === 'coordinator_override');

// Both should exist when status changed by coordinator
assert(statusLogs.length > 0);
assert(coordLogs.length > 0);
```

## Verification Checklist

### Backend Routes

- [ ] `GET /api/v1/groups/:groupId/status` exists and responds with current status
- [ ] `PATCH /api/v1/groups/:groupId/status` exists and is role-protected
- [ ] Routes appear in `/api/v1/groups` router before module.exports
- [ ] Routes properly import controllers from `groupStatusTransition.js`

### Models & Services

- [ ] `Group` model has `status` field with enum: pending_validation, active, inactive, rejected
- [ ] `AuditLog` enum includes `status_transition` action
- [ ] `groupStatusEnum.js` exports all required constants
- [ ] `groupStatusTransition.js` implements all required functions
- [ ] `groupService.js` exports `activateGroup` function

### Validations

- [ ] `createMemberRequest()` checks for `INACTIVE_GROUP_STATUSES` before allowing request
- [ ] `addMember()` checks for `INACTIVE_GROUP_STATUSES` before allowing member addition
- [ ] Both return 409 with `GROUP_INACTIVE` code
- [ ] `transitionStatus()` endpoint validates transitions and returns 409 for invalid
- [ ] Permission checks work: only coordinator/committee/admin/professor can transition

### Audit Trail

- [ ] Each transition creates `status_transition` audit log entry
- [ ] Audit log includes: action, actorId, groupId, timestamp, payload
- [ ] Payload includes: previous_status, new_status, reason
- [ ] IP address and user agent are captured

### State Machine

- [ ] pending_validation → active ✓
- [ ] pending_validation → rejected ✓
- [ ] active → inactive ✓
- [ ] active → rejected ✓
- [ ] inactive → active ✓
- [ ] inactive → rejected ✓
- [ ] rejected states have no allowed transitions ✓

### Error Handling

- [ ] 400: Missing required fields (status, reason)
- [ ] 403: Insufficient permission
- [ ] 404: Group not found
- [ ] 409: Invalid status transition (with details)
- [ ] 409: Group inactive (member operations)
- [ ] 500: Server errors handled gracefully

---

## Quick Integration Test

```bash
# 1. Create a group (should be pending_validation by default)
curl -X POST http://localhost:3000/api/v1/groups \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"groupName": "Test Group"}'

# 2. Check status (should be pending_validation)
curl -X GET http://localhost:3000/api/v1/groups/grp_xyz/status \
  -H "Authorization: Bearer $TOKEN"

# 3. Transition to active
curl -X PATCH http://localhost:3000/api/v1/groups/grp_xyz/status \
  -H "Authorization: Bearer $COORDINATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "active",
    "reason": "Validation completed"
  }'

# 4. Try to add member (should succeed)
curl -X POST http://localhost:3000/api/v1/groups/grp_xyz/members \
  -H "Authorization: Bearer $LEADER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"student_ids": ["student@university.edu"]}'

# 5. Transition to inactive
curl -X PATCH http://localhost:3000/api/v1/groups/grp_xyz/status \
  -H "Authorization: Bearer $COORDINATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "inactive",
    "reason": "Deactivation"
  }'

# 6. Try to add member (should fail with 409 GROUP_INACTIVE)
curl -X POST http://localhost:3000/api/v1/groups/grp_xyz/members \
  -H "Authorization: Bearer $LEADER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"student_ids": ["another_student@university.edu"]}'
```
