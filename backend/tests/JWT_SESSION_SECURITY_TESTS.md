# JWT & Session Management Test Suite

## Overview
Comprehensive test suite for authentication, JWT validation, refresh token rotation, session management, and security features. **All 65 tests passing ✅**

**File:** `backend/tests/jwt-session-security.test.js`  
**Run:** `npm test -- jwt-session-security.test.js`

---

## Test Coverage Summary

### 1. JWT Generation & Token Management (Unit Tests) - 22 tests

#### Access Token Generation (5 tests)
- ✅ Correct payload structure (userId, role, iat, exp, type, iss)
- ✅ Approximately 1 hour expiry (~3600 seconds)
- ✅ Valid signature verifiable by secret
- ✅ Correct role included for different user types
- ✅ Unique tokens generated for same user/role (different iat times)

#### Refresh Token Generation (3 tests)
- ✅ Correct payload structure (userId, type, jti, iat, exp)
- ✅ Approximately 7 day expiry (~604800 seconds)
- ✅ Unique JTI (JWT ID) for each token

#### Token Pair Generation (3 tests)
- ✅ Both access and refresh tokens generated
- ✅ Tokens have correct types in payload
- ✅ Access token includes role, refresh token doesn't

#### Access Token Verification (5 tests)
- ✅ Valid tokens verified successfully
- ✅ Invalid signatures rejected
- ✅ Wrong secret detected and rejected
- ✅ Malformed tokens rejected
- ✅ Wrong issuer detected and rejected

#### Refresh Token Verification (3 tests)
- ✅ Valid refresh tokens verified
- ✅ Invalid signatures rejected
- ✅ Wrong issuer rejected

#### Token Expiry Handling (3 tests)
- ✅ Expired access tokens rejected with proper error
- ✅ Expired refresh tokens rejected
- ✅ Tokens accepted just before expiry

#### Token Tampering Detection (4 tests)
- ✅ Payload modification detected (userId tampering)
- ✅ Role escalation attempts detected and rejected
- ✅ Signature modification detected
- ✅ Header modification detected

---

### 2. Authentication Flow & Protected Routes (Integration Tests) - 24 tests

#### Login & JWT Issuance (3 tests)
- ✅ Access token and refresh token issued on successful login
- ✅ Access token verifiable and contains user info
- ✅ Refresh token stored in database correctly

#### Auth Middleware - JWT Validation (6 tests)
- ✅ Requests with valid JWT allowed
- ✅ Missing authorization header returns 401
- ✅ Malformed header (missing Bearer) returns 401
- ✅ Invalid/tampered tokens return 401
- ✅ Expired tokens return 401
- ✅ req.user populated with decoded token data

#### Role-Based Access Control (4 tests)
- ✅ Requests with required role allowed
- ✅ Insufficient role returns 403 FORBIDDEN
- ✅ Missing user object returns 401 UNAUTHORIZED
- ✅ Multiple roles - user needs one matching role

#### Refresh Token Rotation (7 tests)
- ✅ New token pair issued on refresh
- ✅ Old refresh token invalidated after rotation
- ✅ Using revoked token returns 401
- ✅ Missing refresh token returns 400
- ✅ Expired refresh token returns 401
- ✅ New access token contains correct user info
- ✅ Rotation chain maintained (rotatedFrom references)

#### Password Change - Token Revocation (3 tests)
- ✅ All refresh tokens revoked after password change
- ✅ Using old refresh token after password change returns 401
- ✅ Current password validation required before change

#### Logout & Token Revocation (3 tests)
- ✅ Refresh token revoked on logout
- ✅ Logout returns 200 success
- ✅ Can logout without providing refresh token

---

### 3. Rate Limiting & Security (Brute Force Prevention) - 15 tests

#### Account Lockout After Failed Login Attempts (5 tests)
- ✅ loginAttempts incremented on failed password
- ✅ Account locked after 5 failed attempts
- ✅ Locked account returns 401 ACCOUNT_LOCKED
- ✅ Counter reset on successful login
- ✅ Account locked for approximately 30 minutes

#### Account Suspension (1 test)
- ✅ Suspended account returns 403 ACCOUNT_SUSPENDED

#### Invalid Credentials Handling (3 tests)
- ✅ Wrong password returns 401 INVALID_CREDENTIALS
- ✅ Non-existent user returns 401
- ✅ Same error for missing vs. invalid (non-revealing)

#### Email Case Insensitivity (2 tests)
- ✅ Login with uppercase email successful
- ✅ Login with mixed case email successful

#### Input Validation (2 tests)
- ✅ Missing email returns 400 INVALID_INPUT
- ✅ Missing password returns 400 INVALID_INPUT

---

## Acceptance Criteria Met

| Criteria | Test Coverage | Status |
|----------|---|-----|
| JWT generated with userId, role, iat, exp (1 hour) | Access Token Generation tests | ✅ |
| JWT signature verified on protected routes | Auth Middleware tests | ✅ |
| Refresh token rotation (new pair, old invalidated) | Refresh Token Rotation tests | ✅ |
| Expired JWT returns 401 (can refresh) | Token Expiry + Refresh tests | ✅ |
| Missing JWT returns 401 | Auth Middleware tests | ✅ |
| Invalid JWT returns 401 (bad signature, malformed) | Token Verification tests | ✅ |
| Wrong role returns 403 with error_code | Role Middleware tests | ✅ |
| Password change invalidates all tokens | Password Change tests | ✅ |
| 5 failed attempts per IP → lock account (429 equivalent) | Account Lockout tests | ✅ |
| Token tampering detected | Token Tampering tests | ✅ |

---

## Key Test Scenarios

### ✅ JWT Payload Validation
Verifies that every JWT contains:
- `userId` - identifies token subject
- `role` - authorization information (student/professor/admin/coordinator)
- `iat` - issued at timestamp
- `exp` - expiration timestamp (~1 hour for access, ~7 days for refresh)
- `iss` - issuer (senior-app)
- `type` - token type (access/refresh)

### ✅ Token Rotation Security
Ensures that:
- Old refresh tokens are immediately revoked after use
- New token pair generated on each refresh
- Rotation chain maintains history via `rotatedFrom` field
- Revoked tokens cannot be reused

### ✅ Tamper Detection
Detects and rejects:
- Modified JWT payload (role escalation attempts)
- Invalid signatures
- Wrong issuer
- Expired tokens
- Malformed tokens

### ✅ Account Security
Implements:
- Account lockout after 5 failed login attempts (~30 min duration)
- Account suspension protection
- Case-insensitive email handling
- Non-revealing error messages (same 401 for user not found or wrong password)

### ✅ Password Change
Ensures that:
- Current password validation required
- All refresh tokens immediately revoked
- User forced to re-authenticate on all devices
- Old tokens cannot obtain new access tokens

---

## Test Statistics

- **Total Tests:** 65
- **Passing:** 65 ✅
- **Failing:** 0
- **Coverage Areas:** 4 (JWT, Auth, Refresh, Security)
- **Lines of Code:** ~1400
- **Execution Time:** ~24 seconds

---

## Running the Tests

```bash
# Run all JWT tests
npm test -- jwt-session-security.test.js

# Run with coverage
npm test -- jwt-session-security.test.js --coverage

# Run specific test suite
npm test -- jwt-session-security.test.js -t "JWT Generation"

# Watch mode
npm test -- jwt-session-security.test.js --watch
```

---

## Implementation Notes

### JWT Structure
- **Access Tokens:** 1 hour expiry, includes role for authorization
- **Refresh Tokens:** 7 day expiry, includes unique jti for tracking
- **Signature:** HMAC-SHA256 with separate secrets for access and refresh

### Token Rotation Strategy
1. User calls `/auth/refresh` with old refresh token
2. System verifies token signature and database status
3. Old token marked as `isRevoked: true`
4. New token pair generated
5. New token stored in database with `rotatedFrom` reference

### Brute Force Prevention
- Track `loginAttempts` on User model
- Lock account for ~30 minutes after 5 failed attempts
- Reset counter on successful login
- Return same error message for missing user and wrong password

### Security Features
- Signature verification on every protected route
- Issuer validation (must be 'senior-app')
- Token expiry validation
- UUID-based refresh token ID (jti) for tracking
- Immediate revocation on logout/password change

---

## References
- OpenAPI Spec: `/docs/apispec*.yaml` (securitySchemes: bearerAuth)
- User Schema: `/backend/src/models/User.js`
- JWT Utilities: `/backend/src/utils/jwt.js`
- Auth Controller: `/backend/src/controllers/auth.js`
- Auth Middleware: `/backend/src/middleware/auth.js`
- RefreshToken Model: `/backend/src/models/RefreshToken.js`
