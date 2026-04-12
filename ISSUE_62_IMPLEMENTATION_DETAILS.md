# Issue #62 Implementation Details: Advisor Notification Dispatch

## Executive Summary

Issue #62 resolved **5 critical deficiencies** in the advisor request notification dispatch system:
1. **Fire-and-Forget Pattern**: Eliminated 5000ms response latency
2. **Transient Error Detection**: Smart retry logic that stops on permanent errors
3. **RequestId Logging**: Full traceability in error logs and audit records
4. **Payload Trimming**: Spec-compliant notification schema
5. **Comprehensive Documentation**: Technical comments explaining architectural decisions

---

## Changes Made

### File 1: `src/controllers/groups.js` - createAdvisorRequest()

#### Issue #62 Fix #2 (CRITICAL): Fire-and-Forget Pattern

**Problem:**
```
BEFORE Issue #62:
  Synchronous dispatch loop blocked HTTP response
  for (attempt = 1; attempt <= 3; attempt++) {
    await dispatchAdvisorRequestNotification({...}) // 5000ms timeout each attempt
  }
  Worst case latency: 15 seconds per request
  Client blocked while notification delivery happens
```

**Solution:**
```
AFTER Issue #62:
  res.status(201).json({...}) // Response sent immediately
  setImmediate(async () => {
    await dispatchAdvisorRequestWithRetry({...}) // Background task
  })
  Response latency: <100ms (database only, no notification wait)
  Client receives 201 immediately after D2 persistence
```

**Implementation Pattern:**
```javascript
// 1. Persist request to D2 (MongoDB)
group.advisorRequest = advisorRequest;
await group.save(); // Synchronous point - waits for database

// 2. Send HTTP response (non-blocking)
res.status(201).json({ ... });

// 3. Schedule background task (non-awaited)
setImmediate(async () => {
  // Executes AFTER response sent to client
  const result = await dispatchAdvisorRequestWithRetry({...});
  // Update D2 with notificationTriggered status
  // Log to SyncErrorLog if failed
});
```

**Event Loop Timing:**
```
Timeline:
  T+0ms: Route handler executes
  T+5ms: res.status(201).json({}) queued
  T+10ms: setImmediate callback registered
  T+15ms: Route handler returns
  T+20ms: [Event Loop I/O Phase] HTTP response sent to client (CLIENT RECEIVES 201)
  T+25ms: [Event Loop setImmediate Phase] Background callback executed
  T+30-5030ms: Notification dispatch with retry logic
  T+5030ms: Background task completes (notification result logged)
```

**Partial Failure Model:**
```
Three success outcomes (all return 201):
1. Notification sent → notificationTriggered: true in D2
2. Notification failed (3x retry exhausted) → notificationTriggered: false, logged to SyncErrorLog
3. Background task exception → Caught, logged, doesn't affect HTTP response

KEY: Database persistence happens BEFORE notification attempt
     Client gets 201 immediately after D2 commit
     Notification delivery is decoupled from request response
```

---

#### Issue #62 Fix #3 (CRITICAL): Transient Error Detection

**Problem:**
```
BEFORE Issue #62:
  All errors retried 3 times, even permanent client errors
  
  Example: Payload format violation (4xx error)
    Attempt 1: POST with malformed data → 400 Bad Request
    Wait: 100ms backoff
    Attempt 2: POST with same malformed data → 400 Bad Request
    Wait: 200ms backoff
    Attempt 3: POST with same malformed data → 400 Bad Request
  
  Result: 5000ms + 100ms + 5000ms + 200ms + 5000ms = 15.3 seconds wasted
  Problem: Retrying won't fix payload that's structurally wrong
```

**Solution:**
```
AFTER Issue #62:
  Smart classification: Transient vs Permanent errors
  
  Example: Same payload format violation
    Attempt 1: POST with malformed data → 400 Bad Request
    → isTransientError(err) returns false (4xx = permanent)
    → Stop immediately, return error result
  
  Result: 5000ms timeout + error return = 5.0 seconds
  Improvement: Save 10+ seconds on permanent client errors
```

**Error Classification:**
```javascript
const isTransientError = (error) => {
  // No response (network error): transient, retry
  if (!error.response) return true;

  const status = error.response.status;

  // 4xx client errors: permanent, don't retry
  if (status >= 400 && status < 500) return false;

  // 5xx server errors, timeouts, etc: transient, retry
  return true;
};
```

**Error Categories:**
```
PERMANENT ERRORS (Stop immediately, don't retry):
  - 400 Bad Request: Payload malformed or missing fields
  - 401 Unauthorized: Authentication failed
  - 403 Forbidden: Access denied to endpoint
  - 404 Not Found: Notification Service endpoint doesn't exist
  - 422 Unprocessable Entity: Invalid data structure
  → Retrying won't fix these; return error immediately

TRANSIENT ERRORS (Retry up to 3 times with backoff):
  - 5xx Server Errors: Service experiencing temporary issues
  - Timeout (ECONNABORTED): Network connection timed out
  - Network Error (no response): Connection refused or unreachable
  - Temporary network glitches: Packet loss, latency spike
  → Service may recover; retry with exponential backoff
```

**Retry Logic with Transient Check:**
```javascript
const dispatchAdvisorRequestWithRetry = async ({ groupId, requesterId, message }) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(...); // 5000ms timeout
      return { ok: true, notificationId: response.data.id, attempts: attempt };
    } catch (err) {
      if (!isTransientError(err)) {
        // Permanent error: stop immediately
        return {
          ok: false,
          attempts: attempt,
          lastError: `Permanent error (${err.response.status}): ${err.message}`
        };
      }
      // Transient error: retry with backoff
      if (attempt < 3) {
        const backoffMs = 100 * attempt; // 100ms, 200ms
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  // All 3 retries exhausted (transient errors only)
  return { ok: false, attempts: 3, lastError: `All retries failed: ${lastError}` };
};
```

---

#### Issue #62 Fix #4 (HIGH): RequestId in Error Logs

**Problem:**
```
BEFORE Issue #62:
  Error logs missing requestId reference
  
  SyncErrorLog entry:
    {
      service: 'notification',
      groupId: 'group_123',
      actorId: 'user_456',
      attempts: 3,
      lastError: 'Connection timeout'
      // MISSING: requestId!
    }
  
  Operational Issue:
    - Can't correlate notification failure back to original request
    - Can't trace: failed notification → group → professor → retry
    - Hard to debug: which request had which notification ID?
```

**Solution:**
```
AFTER Issue #62:
  Explicit requestId in all logs
  
  SyncErrorLog entry:
    {
      service: 'notification',
      groupId: 'group_123',
      actorId: 'user_456',
      attempts: 3,
      lastError: 'Connection timeout'
      // NOW INCLUDED:
      requestId: 'adv_req_a1b2c3d4'
    }
  
  AuditLog entry:
    {
      action: 'sync_error',
      actorId: 'user_456',
      groupId: 'group_123',
      payload: {
        requestId: 'adv_req_a1b2c3d4', // Explicit for traceability
        api_type: 'notification',
        retry_count: 3,
        last_error: 'Connection timeout',
        event_type: 'advisor_request_notification_failed'
      }
    }
  
  Operational Benefit:
    - Query SyncErrorLog: WHERE requestId='adv_req_a1b2c3d4'
    - Find corresponding group, professor, original requestor
    - Replay notification with same context
    - Full traceability: Request → Error → Retry decision
```

**Implementation:**
```javascript
// Success case: Include requestId in audit log
await createAuditLog({
  action: 'advisor_request_notification_sent',
  actorId: requesterId,
  groupId: group.groupId,
  payload: {
    requestId: advisorRequest.requestId, // ← Issue #62 Fix: Include requestId
    professorId: professor.userId,
    notificationId: dispatchResult.notificationId,
  }
});

// Failure case: Include requestId in error logs
const syncErr = await SyncErrorLog.create({
  service: 'notification',
  groupId: group.groupId,
  actorId: requesterId,
  requestId: advisorRequest.requestId, // ← Issue #62 Fix: Include requestId
  attempts: dispatchResult.attempts,
  lastError: dispatchResult.lastError,
});

await createAuditLog({
  action: 'sync_error',
  actorId: requesterId,
  groupId: group.groupId,
  payload: {
    requestId: advisorRequest.requestId, // ← Issue #62 Fix: Include requestId
    api_type: 'notification',
    retry_count: dispatchResult.attempts,
    last_error: dispatchResult.lastError,
    sync_error_id: syncErr.errorId,
  }
});
```

---

#### Issue #62 Fix #5 (MEDIUM): Trimmed Payload Format

**Problem:**
```
BEFORE Issue #62:
  Payload included extra fields violating API spec
  
  dispatchAdvisorRequestNotification({
    requestId: 'adv_req_abc',      // ← Extra (not in spec)
    groupId: 'group_123',
    groupName: 'Team Alpha',       // ← Extra (not in spec)
    professorId: 'prof_456',       // ← Extra (recipient handled separately)
    requesterId: 'student_789',
    message: 'Please join our team'
  })
  
  Notification Service expects: { groupId, requesterId, message }
  Extra fields cause schema validation errors
  Service rejects with 400 Bad Request
  Results in sync_error log entry (unnecessary retry waste)
```

**Solution:**
```
AFTER Issue #62:
  Trimmed to spec-required fields only
  
  dispatchAdvisorRequestWithRetry({
    groupId: 'group_123',          // ← Required
    requesterId: 'student_789',    // ← Required
    message: 'Please join our team' // ← Required
    // requestId, groupName removed
  })
  
  Payload matches Notification Service schema exactly
  Service accepts 200 OK
  Better API contract compliance
```

**API Contract (OpenAPI):**
```yaml
Notification Service API:
  POST /api/notifications
  requestBody:
    type: object
    required:
      - type
      - groupId
      - requesterId
      - message
    properties:
      type: { type: string, enum: ['advisee_request'] }
      groupId: { type: string, description: 'Group ID requesting advisor' }
      requesterId: { type: string, description: 'User ID of group leader' }
      message: { type: string, nullable: true, description: 'Custom message' }
  responses:
    '200':
      content:
        application/json:
          schema:
            type: object
            properties:
              notification_id: { type: string }
              status: { type: string, enum: ['sent', 'queued'] }
```

**Implementation:**
```javascript
const dispatchAdvisorRequestWithRetry = async ({ groupId, requesterId, message }) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications`,
        {
          type: 'advisee_request',
          groupId,           // ← Only required fields
          requesterId,       // ← No extra fields
          message: message || null // ← Null allowed per spec
        },
        { timeout: 5000 }
      );
      return {
        ok: true,
        notificationId: response.data.notification_id || response.data.id,
        attempts: attempt
      };
    } catch (err) {
      // Retry logic...
    }
  }
};
```

---

### File 2: `src/services/notificationService.js`

#### New Functions Added

**1. isTransientError(error)**
```javascript
/**
 * Classify HTTP errors as transient (retryable) or permanent (non-retryable)
 * 
 * Returns true (retry) for:
 *   - Network failures (no response): Connection refused, unreachable
 *   - 5xx server errors: 500, 502, 503, 504 (service may recover)
 *   - Timeout errors: ECONNABORTED, ETIMEDOUT
 * 
 * Returns false (don't retry) for:
 *   - 4xx client errors: 400, 401, 403, 404, 422 (won't fix on retry)
 *   - Indicates client mistake, not service issue
 * 
 * @param {Error} error - Caught error from axios request
 * @returns {boolean} true if should retry, false if give up
 */
```

**2. dispatchAdvisorRequestWithRetry({ groupId, requesterId, message })**
```javascript
/**
 * Dispatch notification with intelligent retry logic
 * 
 * Features:
 *   - 3 retry attempts maximum
 *   - Exponential backoff: [100ms, 200ms] between attempts
 *   - Transient error detection: only retry 5xx/network errors
 *   - Permanent error detection: stop on 4xx errors immediately
 *   - 5000ms timeout per attempt (prevents hanging)
 * 
 * Returns object:
 *   {
 *     ok: boolean,              // true if notification sent
 *     notificationId: string,   // if ok=true
 *     attempts: number,         // 1-3 attempts made
 *     lastError: string         // if ok=false
 *   }
 * 
 * @param {object} payload - {groupId, requesterId, message}
 * @returns {object} Result with status and error details
 */
```

---

## Performance Improvements

### Response Latency (Client Perspective)

```
BEFORE Issue #62:
  Synchronous dispatch blocks response
  
  Example timeline:
    0ms:    POST /advisor-requests
    50ms:   Database persist (D2 write)
    55ms:   Start notification dispatch
    5055ms: Attempt 1 timeout or success
    5155ms: 100ms backoff
    5255ms: Attempt 2 timeout or success
    5455ms: 200ms backoff
    5655ms: Attempt 3 timeout or success
    5755ms: Send HTTP response (201)
  
  CLIENT LATENCY: 5755ms = 5.75 seconds

AFTER Issue #62:
  Fire-and-forget with immediate response
  
  Example timeline:
    0ms:    POST /advisor-requests
    50ms:   Database persist (D2 write)
    55ms:   Send HTTP response (201) ← CLIENT RECEIVES 201 HERE
    60ms:   setImmediate queued callback scheduled
    65ms:   Return from route handler
    
  CLIENT LATENCY: 55ms = 0.055 seconds
  
  IMPROVEMENT: 100x faster (5750ms vs 55ms)
```

### Notification Dispatch Latency (Background Task)

```
BEFORE Issue #62:
  All errors retried 3 times
  
  Permanent error scenario (4xx):
    0ms:    Attempt 1: 400 Bad Request (5000ms timeout)
    5050ms: Attempt 2: 400 Bad Request (5000ms timeout)
    10100ms: Attempt 3: 400 Bad Request (5000ms timeout)
    15150ms: Give up, log error
  
  DISPATCH LATENCY: 15150ms = 15.15 seconds (wasted)

AFTER Issue #62:
  Transient error detection stops on permanent errors
  
  Permanent error scenario (4xx):
    0ms:    Attempt 1: 400 Bad Request (5000ms timeout)
    5050ms: isTransientError() → false (4xx permanent)
    5055ms: Stop retrying, return error
  
  DISPATCH LATENCY: 5055ms = 5.05 seconds
  
  IMPROVEMENT: 3x faster (15150ms vs 5050ms)
  SAVINGS: 10+ seconds per permanent error
```

---

## Testing Checklist

```javascript
// Test 1: Fire-and-Forget Pattern
POST /groups/group_123/advisor-requests
{
  "professorId": "prof_456",
  "message": "Please be our advisor"
}
✅ Expect: 201 response within 100ms
✅ Expect: D2 contains advisor request with notificationTriggered: false
✅ Expect: Background task logs success/failure to SyncErrorLog (async)

// Test 2: Transient Error Detection
Notification Service: Responds with 503 (server error)
✅ Expect: Retry attempts: 1 → 100ms backoff → 2 → 200ms backoff → 3
✅ Expect: Total dispatch time: ~5000ms * 3 + 300ms backoff = 15.3s

Notification Service: Responds with 400 (permanent error)
✅ Expect: Retry attempts: 1 only (no retries)
✅ Expect: Total dispatch time: ~5000ms (one attempt only)
✅ Improvement: Saves 10+ seconds on permanent errors

// Test 3: RequestId in Logs
Trigger notification failure
✅ Expect: SyncErrorLog contains requestId field
✅ Expect: AuditLog payload includes requestId
✅ Expect: Query by requestId enables debugging

// Test 4: Payload Trimming
Inspect HTTP request to Notification Service
✅ Expect: Payload only includes: type, groupId, requesterId, message
✅ Expect: No extra fields: requestId, groupName, professorId
✅ Expect: 200 OK response (not 400 validation error)

// Test 5: Multiple Concurrent Requests
POST /advisor-requests (5 concurrent requests)
✅ Expect: All 5 return 201 in <100ms each
✅ Expect: D2 contains 5 separate advisor request records
✅ Expect: Background tasks process independently
✅ Expect: SyncErrorLog entries for any failures (with unique requestIds)
```

---

## Monitoring & Operational Runbook

### Key Metrics to Monitor

1. **Response Latency**: POST /advisor-requests response time
   ```
   Target: <100ms
   Alert: >500ms (indicates database or I/O issue)
   ```

2. **Background Task Success Rate**: SyncErrorLog entries / total requests
   ```
   Target: >99% (notification delivery)
   Alert: <95% (indicates Notification Service issues)
   ```

3. **Retry Breakdown**: Permanent vs Transient errors
   ```
   Query: SyncErrorLog.distinct('lastError')
   Alert: Increase in 4xx errors (permanent failures)
   Alert: Increase in 5xx errors (Notification Service issues)
   ```

### Debugging Failed Notifications

1. **Find failing request:**
   ```
   SyncErrorLog.findOne({ requestId: 'adv_req_abc123' })
   → Returns: attempts, lastError, groupId, actorId
   ```

2. **Trace to original request:**
   ```
   AuditLog.findOne({
     action: 'advisor_request_created',
     payload: { requestId: 'adv_req_abc123' }
   })
   → Returns: Original context, timestamps, actor info
   ```

3. **Verify Notification Service status:**
   ```
   Health check: GET /health at NOTIFICATION_SERVICE_URL
   Logs: Check Notification Service error logs for same timestamp
   ```

4. **Manual retry if needed:**
   ```javascript
   const req = SyncErrorLog.findById(syncErrorId);
   const group = Group.findById(req.groupId);
   const result = await dispatchAdvisorRequestWithRetry({
     groupId: group.groupId,
     requesterId: req.actorId,
     message: group.advisorRequest.message
   });
   if (result.ok) {
     group.advisorRequest.notificationTriggered = true;
     await group.save();
   }
   ```

---

## Summary of Issue #62 Fixes

| Issue | Severity | Before | After | Benefit |
|-------|----------|--------|-------|---------|
| Response blocking on notification | CRITICAL | 5000ms+ latency | <100ms latency | 50-100x faster |
| All errors retried (even permanent) | CRITICAL | 15s+ on 4xx errors | 5s on 4xx errors | Save 10+ seconds |
| Missing requestId in logs | HIGH | No traceability | Full traceability | Better debugging |
| Extra payload fields | MEDIUM | 400 validation errors | Spec compliant | No retry waste |
| Documentation | SUPPORT | Minimal | Comprehensive | Better maintenance |

---

## References

- **DFD Process**: Process 3.3 (Notify Advisor)
- **PR Review Issues**: #62 PR #162 Review Comments
- **API Spec**: [docs/apispec2_4.yaml](docs/apispec2_4.yaml)
- **Related Code**:
  - [src/controllers/groups.js#L1127](src/controllers/groups.js#L1127) - createAdvisorRequest()
  - [src/services/notificationService.js](src/services/notificationService.js) - Dispatch functions
  - [src/models/AdvisorRequest.js](src/models/AdvisorRequest.js) - D2 schema (Issue #61)
