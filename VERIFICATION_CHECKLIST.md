# Implementation Verification Checklist

Use this checklist to verify all components are properly installed and working.

## Pre-Flight Checks

### Prerequisites
- [ ] Node.js 14+ installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] MongoDB running locally or connection string configured
- [ ] Git initialized in project

### Environment Setup
- [ ] Backend: `.env` file created from `.env.example`
- [ ] Frontend: `.env.local` file created from `.env.example`
- [ ] Backend: JWT secrets configured
- [ ] Backend: MongoDB URI configured
- [ ] Frontend: API URL matches backend (http://localhost:5000/api/v1)

---

## Backend Installation

### Step 1: Install Dependencies
```bash
cd backend
npm install
```
- [ ] No errors during npm install
- [ ] node_modules/ directory created
- [ ] package-lock.json created

### Step 2: Verify Structure
- [ ] `src/` directory exists
- [ ] `src/index.js` file exists
- [ ] `src/routes/auth.js` file exists
- [ ] `src/controllers/auth.js` file exists
- [ ] `src/middleware/auth.js` file exists
- [ ] `src/models/User.js` file exists
- [ ] `src/models/RefreshToken.js` file exists
- [ ] `src/utils/jwt.js` file exists
- [ ] `src/utils/password.js` file exists

### Step 3: Start Backend
```bash
npm run dev
```
- [ ] Server starts without errors
- [ ] Console shows "MongoDB connected successfully"
- [ ] Console shows "Server is running on port 5000"
- [ ] Health check works: `curl http://localhost:5000/health`

---

## Frontend Installation

### Step 1: Install Dependencies
```bash
cd frontend
npm install
```
- [ ] No errors during npm install
- [ ] node_modules/ directory created
- [ ] package-lock.json created

### Step 2: Verify Structure
- [ ] `src/` directory exists
- [ ] `src/App.js` file exists
- [ ] `src/index.js` file exists
- [ ] `src/store/authStore.js` file exists
- [ ] `src/api/apiClient.js` file exists
- [ ] `src/api/authService.js` file exists
- [ ] `src/components/` directory with all components
- [ ] `src/utils/passwordValidator.js` file exists
- [ ] `public/index.html` file exists

### Step 3: Start Frontend
```bash
npm start
```
- [ ] React app starts in development mode
- [ ] App opens in browser (usually http://localhost:3000)
- [ ] No console errors
- [ ] Auth method selection screen displays

---

## Functionality Testing

### Authentication Flow Tests

#### Test 1: Registration
1. [ ] Click "Create Account" button
2. [ ] Fill in email: `test@university.edu`
3. [ ] Fill in password: `TestPassword123!`
4. [ ] Confirm password: `TestPassword123!`
5. [ ] Enter validation token: `dummy-token`
6. [ ] Click "Create Account"
7. [ ] Should see success and redirect to dashboard
8. [ ] Check localStorage has auth data:
   ```javascript
   localStorage.getItem('auth-storage')
   ```
   - [ ] Contains `accessToken`
   - [ ] Contains `refreshToken`
   - [ ] Contains `user` info

#### Test 2: Logout
1. [ ] On dashboard, click logout button (if implemented)
2. [ ] [ ] Should redirect to login
3. [ ] Check localStorage:
   ```javascript
   localStorage.removeItem('auth-storage')  // Should be empty
   ```

#### Test 3: Session Persistence
1. [ ] Login with test credentials
2. [ ] Open browser DevTools (F12)
3. [ ] Go to Application → Storage → Local Storage
4. [ ] Verify `auth-storage` key contains tokens
5. [ ] Refresh page (F5)
6. [ ] [ ] User should still be logged in
7. [ ] [ ] No re-login required

#### Test 4: Protected Routes
1. [ ] Logout or clear localStorage manually
2. [ ] Try to navigate to `/dashboard` directly
3. [ ] [ ] Should redirect to `/auth/login`
4. [ ] Login with valid credentials
5. [ ] [ ] Dashboard should now be accessible

#### Test 5: Password Validation
1. [ ] Try to register with weak password: `weak`
2. [ ] [ ] Should show error messages:
   - [ ] "must be at least 8 characters"
   - [ ] "must contain uppercase letter"
   - [ ] "must contain digit"
   - [ ] "must contain special character"
3. [ ] Enter valid password: `ValidPass123!`
4. [ ] [ ] Error message should clear
5. [ ] [ ] Form should be submittable

#### Test 6: Form Validation
1. [ ] Try to submit registration with empty email
2. [ ] [ ] Should show "Email is required"
3. [ ] Try to submit with invalid email: `notanemail`
4. [ ] [ ] Should show "Please enter a valid email address"
5. [ ] Try to mismatched passwords
6. [ ] [ ] Should show "Passwords do not match"

---

## API Testing

### Using cURL

#### Test Backend Health
```bash
curl http://localhost:5000/health
```
- [ ] Returns `{"status":"ok","timestamp":"..."}`

#### Test Registration
```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "validationToken": "test",
    "email": "curl@test.edu",
    "password": "CurlTest123!",
    "connectGithub": false
  }'
```
- [ ] Returns 201 status
- [ ] Response includes `userId`, `accessToken`, `refreshToken`

#### Test Login
```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "curl@test.edu",
    "password": "CurlTest123!"
  }'
```
- [ ] Returns 200 status
- [ ] Response includes tokens and user info

#### Test Token Refresh
```bash
# Use refreshToken from previous response
curl -X POST http://localhost:5000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<REFRESH_TOKEN_HERE>"
  }'
```
- [ ] Returns 200 status
- [ ] Response includes new `accessToken` and `refreshToken`
- [ ] Old token no longer works (test with old token in new request)

#### Test Protected Endpoint
```bash
# Use accessToken from previous response
curl -X GET http://localhost:5000/api/v1/onboarding/accounts/usr_123 \
  -H "Authorization: Bearer <ACCESS_TOKEN_HERE>"
```
- [ ] Returns 200 if user exists
- [ ] Returns 404 if user doesn't exist
- [ ] Returns 401 with invalid token

---

## Database Verification

### MongoDB Connection
```bash
# In MongoDB shell
use senior-app
db.users.find()
db.refreshtokens.find()
```
- [ ] Users collection has at least 1 document
- [ ] RefreshTokens collection exists
- [ ] Fields match schema (userId, email, hashedPassword, etc.)

### User Document Check
```bash
db.users.findOne()
```
- [ ] Has `userId` field
- [ ] Has `email` field
- [ ] Has `hashedPassword` (bcrypt hash, not plain text!)
- [ ] Has `role` field
- [ ] Has `emailVerified` boolean
- [ ] Has `accountStatus` field
- [ ] Has `createdAt` and `updatedAt` timestamps

---

## Error Handling Tests

### Test 401 Response
1. [ ] Open DevTools Network tab
2. [ ] Make API request with expired token
3. [ ] Observe 401 response
4. [ ] [ ] Auto-retry happens with new token
5. [ ] [ ] Original request completes successfully

### Test 403 Response
1. [ ] Admin endpoint with student account
2. [ ] [ ] Should return 403 Forbidden
3. [ ] Observe error message in console

### Test Invalid Credentials
1. [ ] Login with wrong email
2. [ ] [ ] Should show "Invalid email or password"
3. [ ] Attempt 5 times with wrong password
4. [ ] [ ] Account should lock
5. [ ] [ ] 6th attempt shows "Account is temporarily locked"

---

## UI/UX Verification

### Visual Elements
- [ ] Auth method selection screen displays properly
- [ ] Login form is centered and responsive
- [ ] Registration form shows all required fields
- [ ] Password strength indicator shows/hides appropriately
- [ ] Error messages display in red
- [ ] Buttons disable while submitting
- [ ] Loading states show "Signing in..." etc.

### Responsive Design
- [ ] Test on desktop (1920x1080 and 1366x768)
- [ ] Test on tablet (768x1024)
- [ ] Test on mobile (375x667)
- [ ] All elements readable on mobile
- [ ] Forms stack properly on mobile
- [ ] Buttons are touch-friendly (>44px)

### Accessibility
- [ ] Can tab through form fields
- [ ] Error messages are readable
- [ ] Links have underlines
- [ ] Buttons have hover states
- [ ] Color not sole indicator of state

---

## Performance Testing

### Load Tests
1. [ ] Register 10 users in quick succession
2. [ ] [ ] No errors or rate limiting (add if needed)
3. [ ] Login 5 times with same account
4. [ ] [ ] Session properly isolated

### Token Size
```javascript
const token = localStorage.getItem('auth-storage');
console.log(token.length);  // Should be <5000 bytes
```
- [ ] Access token < 500 characters
- [ ] Refresh token < 500 characters
- [ ] Total auth storage < 5KB

---

## Security Verification

### Password Hashing
```bash
db.users.findOne()  # Check hashedPassword field
```
- [ ] Password is NOT stored as plain text
- [ ] Hash starts with `$2a$`, `$2b$`, or `$2y$` (bcrypt indicator)
- [ ] Hash is different every login (different salt)

### Token Validation
```javascript
// Decode token (DON'T verify signature, just decode)
const token = "...";
const decoded = JSON.parse(atob(token.split('.')[1]));
console.log(decoded);
// Should show: { userId, role, type, iat, exp, iss, sub }
```
- [ ] `exp` is present and in future
- [ ] `iat` is present
- [ ] `userId` is present
- [ ] `role` is valid value

### Token Rotation
1. [ ] Note current refreshToken value
2. [ ] Call refresh endpoint
3. [ ] Note new refreshToken value
4. [ ] [ ] Values should be different
5. [ ] Try to use old refreshToken
6. [ ] [ ] Should return 401 "token has been revoked"

---

## Documentation Verification

- [ ] AUTHENTICATION_SETUP.md exists and is readable
- [ ] README.md exists with quick start
- [ ] IMPLEMENTATION_EXAMPLES.md exists with code samples
- [ ] DELIVERABLES.md exists with checklist
- [ ] Backend .env.example configured correctly
- [ ] Frontend .env.example configured correctly
- [ ] Comments in code explain complex logic

---

## Final Sign-Off

### Developer Checklist
- [ ] All code committed to git
- [ ] No console errors in browser
- [ ] No console errors in terminal
- [ ] All files follow naming conventions
- [ ] No hardcoded secrets or passwords
- [ ] .gitignore includes node_modules and .env

### QA Checklist
- [ ] All acceptance criteria met
- [ ] All test scenarios pass
- [ ] No security vulnerabilities found
- [ ] Performance acceptable
- [ ] Documentation complete

### Deployment Readiness
- [ ] Backend can start with `npm run dev`
- [ ] Frontend can start with `npm start`
- [ ] Environment variables template complete
- [ ] Database schema verified
- [ ] API endpoints tested

---

## Common Issues & Solutions

### Issue: MongoDB Connection Failed
**Solution:**
- [ ] Ensure MongoDB is running
- [ ] Check MONGODB_URI in .env
- [ ] Verify database exists or auto-create is enabled

### Issue: CORS Errors
**Solution:**
- [ ] Backend CORS configured for frontend origin
- [ ] Check backend origin in error message
- [ ] Verify headers are correct

### Issue: Tokens Not Persisting
**Solution:**
- [ ] Check localStorage not disabled in browser
- [ ] Verify Zustand persist middleware active
- [ ] Check browser privacy settings

### Issue: 401 Refresh Loop
**Solution:**
- [ ] Verify refreshToken is valid
- [ ] Check JWT_REFRESH_SECRET matches
- [ ] Ensure refresh token not expired (7 days)

---

## Sign-Off

**Date Completed:** _______________

**Tested By:** _______________

**Status:** 
- [ ] Ready for Development
- [ ] Ready for Testing
- [ ] Ready for Staging
- [ ] Ready for Production

**Notes/Issues:** 
_____________________________________________________________________
_____________________________________________________________________
_____________________________________________________________________

---

*This checklist should be completed before code review and deployment.*
