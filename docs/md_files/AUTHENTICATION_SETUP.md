# Complete Authentication System Implementation

This document provides a comprehensive guide to the implemented authentication system for the Senior Project Management System.

## System Overview

The authentication system includes:

### **Backend Features**
- ✅ JWT-based authentication with token pairs (access + refresh)
- ✅ Local email/password authentication
- ✅ GitHub OAuth integration (scaffolding)
- ✅ Token refresh with automatic rotation
- ✅ Password hashing with bcryptjs
- ✅ Account status management (pending, active, suspended)
- ✅ Login attempt tracking and account locking
- ✅ Protected route middleware
- ✅ Role-based access control
- ✅ Comprehensive error handling

### **Frontend Features**
- ✅ Global auth state management (Zustand)
- ✅ Auth method selection UI (local vs GitHub)
- ✅ Login form with validation
- ✅ Registration form with password strength validation
- ✅ Protected route component
- ✅ HTTP interceptor for 401/403 responses
- ✅ Automatic token refresh on 401
- ✅ Session persistence across page refresh
- ✅ Logout with token revocation

---

## Backend Setup

### Prerequisites
- Node.js 14+
- MongoDB running locally or connection string

### Installation

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your configuration:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/senior-app
   JWT_SECRET=your-super-secret-jwt-key
   JWT_REFRESH_SECRET=your-super-secret-refresh-key
   JWT_EXPIRATION=15m
   JWT_REFRESH_EXPIRATION=7d
   GITHUB_CLIENT_ID=your-github-client-id
   GITHUB_CLIENT_SECRET=your-github-client-secret
   FRONTEND_URL=http://localhost:3000
   ```

3. **Start MongoDB:**
   ```bash
   # macOS with Homebrew
   brew services start mongodb-community
   
   # Or using Docker
   docker run -d -p 27017:27017 --name mongodb mongo
   ```

4. **Start backend server:**
   ```bash
   npm run dev
   ```

   Server will run on `http://localhost:5000`

### API Endpoints

#### Authentication Public Routes

**Login**
```bash
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@university.edu",
  "password": "SecurePassword123!"
}
```

Response (200):
```json
{
  "userId": "usr_abc123",
  "email": "user@university.edu",
  "role": "student",
  "emailVerified": true,
  "accountStatus": "active",
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

**Register**
```bash
POST /api/v1/auth/register
Content-Type: application/json

{
  "validationToken": "token-from-student-id-validation",
  "email": "user@university.edu",
  "password": "SecurePassword123!",
  "connectGithub": false
}
```

**Refresh Token**
```bash
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGc..."
}
```

Response (200):
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

#### Protected Routes

**Logout**
```bash
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "refreshToken": "eyJhbGc..."
}
```

**Initiate GitHub OAuth**
```bash
POST /api/v1/auth/github/oauth/initiate
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "redirectUri": "http://localhost:3000/auth/github-oauth/callback"
}
```

Response (200):
```json
{
  "authorizationUrl": "https://github.com/login/oauth/authorize?...",
  "state": "random-state-token"
}
```

### Token Structure

**Access Token (JWT)**
```json
{
  "userId": "usr_abc123",
  "role": "student",
  "type": "access",
  "iat": 1234567890,
  "exp": 1234568790,
  "iss": "senior-app",
  "sub": "usr_abc123"
}
```

**Refresh Token (JWT)**
```json
{
  "userId": "usr_abc123",
  "type": "refresh",
  "iat": 1234567890,
  "exp": 1234654290,
  "iss": "senior-app",
  "sub": "usr_abc123"
}
```

### Database Models

#### User Model
- `userId`: Unique identifier (auto-generated)
- `email`: User email (unique, lowercase)
- `hashedPassword`: Bcrypt hashed password
- `role`: student | professor | admin | coordinator
- `githubUsername`: Optional GitHub username
- `githubId`: Optional GitHub user ID
- `emailVerified`: Boolean flag
- `accountStatus`: pending | active | suspended
- `loginAttempts`: Track failed login attempts
- `lockedUntil`: Account lock timestamp (30 min after 5 failures)
- `timestamps`: createdAt, updatedAt

#### RefreshToken Model
- `tokenId`: Unique identifier for this token
- `userId`: Reference to user
- `token`: The actual JWT string
- `rotatedFrom`: Reference to previous token (for rotation tracking)
- `isRevoked`: Boolean flag
- `userAgent`: User agent string
- `ipAddress`: Client IP address
- `expiresAt`: Token expiration timestamp
- `lastUsedAt`: Last time this token was used
- `timestamps`: createdAt, updatedAt

---

## Frontend Setup

### Prerequisites
- Node.js 14+
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local`:
   ```env
   REACT_APP_API_URL=http://localhost:5000/api/v1
   REACT_APP_GITHUB_CLIENT_ID=your-github-client-id
   REACT_APP_ENVIRONMENT=development
   ```

3. **Start development server:**
   ```bash
   npm start
   ```

   Frontend will run on `http://localhost:3000`

### Project Structure

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── api/
│   │   ├── apiClient.js          # Axios instance with interceptors
│   │   └── authService.js        # Auth API calls
│   ├── components/
│   │   ├── AuthMethodSelection.js # Auth method selection UI
│   │   ├── AuthForms.css          # Auth forms styles
│   │   ├── LoginForm.js           # Login form component
│   │   ├── RegisterForm.js        # Registration form component
│   │   ├── ProtectedRoute.js      # Protected route wrapper
│   │   └── AuthMethodSelection.css
│   ├── store/
│   │   └── authStore.js           # Zustand auth store
│   ├── utils/
│   │   └── passwordValidator.js   # Password strength validator
│   ├── App.js                     # Main app component
│   ├── App.css                    # App styles
│   ├── index.js                   # Entry point
│   └── index.css                  # Global styles
├── .env.example
└── package.json
```

### Key Components

#### 1. **Auth Store (Zustand)**
Manages global authentication state with persistence to localStorage.

```javascript
import useAuthStore from './store/authStore';

// In your component
const { user, accessToken, isAuthenticated, setAuth, clearAuth } = useAuthStore();
```

#### 2. **API Client with Interceptors**
Automatically handles token refresh and 401/403 errors.

```javascript
import apiClient from './api/apiClient';

// Makes authenticated requests
apiClient.get('/protected/endpoint')
  .then(response => console.log(response.data))
  .catch(error => console.error(error));
```

#### 3. **Protected Routes**
Blocks unauthenticated access to routes.

```javascript
<Route
  path="/dashboard"
  element={<ProtectedRoute component={Dashboard} requiredRoles={['student', 'admin']} />}
/>
```

#### 4. **Auth Method Selection**
Allows users to choose authentication method.

```javascript
<AuthMethodSelection isRegistration={false} />
```

### Session Persistence

Session data is automatically persisted to localStorage and restored on page refresh:

```javascript
// User info, tokens persist across refresh
const { user, accessToken, refreshToken } = useAuthStore();

// Automatic token refresh when accessing protected resources
// 401 responses trigger automatic refresh and retry
```

---

## Authentication Flow

### Login Flow
1. User enters email and password
2. Frontend sends POST /auth/login
3. Backend validates credentials
4. Backend returns accessToken + refreshToken
5. Frontend stores tokens in Zustand store (localStorage)
6. Frontend redirects to dashboard

### Session Expiration & Refresh
1. User makes API request with expired accessToken
2. API returns 401 Unauthorized
3. Frontend interceptor catches 401
4. Frontend sends POST /auth/refresh with refreshToken
5. Backend validates refreshToken and issues new pair
6. Old refreshToken is revoked (rotated)
7. Frontend retries original request with new accessToken
8. If refresh fails, user is redirected to login

### Logout Flow
1. User clicks logout
2. Frontend sends POST /auth/logout with refreshToken
3. Backend revokes refreshToken in database
4. Frontend clears auth store (tokens and user)
5. User is redirected to login

---

## Security Considerations

### Implemented
- ✅ Password hashing with bcryptjs (10 salt rounds)
- ✅ JWT signing with secrets
- ✅ Token expiration (15m access, 7d refresh)
- ✅ Refresh token rotation (old token revoked on refresh)
- ✅ Token storage in localStorage with CORS protection
- ✅ Account locking after 5 failed login attempts (30 min)
- ✅ Role-based access control middleware
- ✅ HTTP-only cookie option available

### Recommended For Production
- [ ] Use HTTP-only, Secure, SameSite cookies for refresh tokens
- [ ] Implement CSRF protection
- [ ] Add rate limiting on auth endpoints
- [ ] Implement request signing for sensitive operations
- [ ] Use secrets management (AWS Secrets Manager, HashiCorp Vault)
- [ ] Implement audit logging for auth events
- [ ] Add 2FA support
- [ ] Use HTTPS only
- [ ] Implement IP whitelisting for admin endpoints

---

## Error Handling

### Common Error Codes

**400 - Bad Request**
- Missing or invalid input
- Invalid email format
- Weak password

**401 - Unauthorized**
- Missing authorization header
- Invalid or expired token
- Invalid credentials

**403 - Forbidden**
- Insufficient permissions for resource
- Account suspended

**409 - Conflict**
- User already exists

**500 - Server Error**
- Database error
- Token generation error

---

## Testing Endpoints

### Using cURL

**Login locally**
```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@university.edu",
    "password": "TestPassword123!"
  }'
```

**Access protected endpoint**
```bash
curl -X GET http://localhost:5000/api/v1/onboarding/accounts/usr_abc123 \
  -H "Authorization: Bearer <accessToken>"
```

**Refresh token**
```bash
curl -X POST http://localhost:5000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refreshToken>"
  }'
```

---

## Next Steps

### Immediate TODOs
1. [ ] Implement student ID validation endpoint
2. [ ] Complete GitHub OAuth flow in frontend
3. [ ] Add email verification logic
4. [ ] Implement password reset flow
5. [ ] Add professor onboarding endpoint
6. [ ] Create Dashboard component
7. [ ] Add user profile management
8. [ ] Implement account update endpoints

### Future Enhancements
1. [ ] Two-factor authentication (2FA)
2. [ ] Social login (Google, Microsoft)
3. [ ] Session management dashboard
4. [ ] Activity logging and audit trails
5. [ ] DeviceFingerprinting for anomaly detection
6. [ ] Passwordless authentication (WebAuthn)
7. [ ] Integration with university LDAP/SSO

---

## Troubleshooting

### Backend Issues

**MongoDB Connection Error**
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
Solution: Start MongoDB or update MONGODB_URI in .env

**Port Already in Use**
```
Error: listen EADDRINUSE: address already in use :::5000
```
Solution: Kill process on port 5000 or change PORT in .env

### Frontend Issues

**Token Refresh Fails**
- Check backend is running
- Verify JWT_REFRESH_SECRET matches between frontend and backend
- Check refreshToken not expired (7 days default)

**Protected Routes Not Working**
- Verify access token is present in localStorage
- Check token hasn't expired
- Verify backend is returning 401 on invalid tokens

---

## Support

For issues or questions:
1. Check error messages in browser console
2. Check backend logs in terminal
3. Verify environment variables are set correctly
4. Test API endpoints with cURL
5. Check MongoDB is running and accessible
