# Senior Project Management System - Quick Start

## Project Overview

A complete authentication system with role-based access control for the Senior Project Management System. Includes local authentication, GitHub OAuth integration, JWT token management, and protected routes.

## Quick Start

### 1. Backend Setup (5 minutes)

```bash
cd backend

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Start MongoDB (if not already running)
# macOS: brew services start mongodb-community
# Docker: docker run -d -p 27017:27017 --name mongodb mongo

# Start backend server
npm run dev
```

Backend runs on `http://localhost:5000`

### 2. Frontend Setup (5 minutes)

```bash
cd frontend

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env.local

# Start development server
npm start
```

Frontend runs on `http://localhost:3000`

## Initial Testing

### 1. Register a User

1. Navigate to `http://localhost:3000`
2. Click "Create Account"
3. Fill in email, password (min 8 chars, must include uppercase, lowercase, digit, special char)
4. Use a dummy validation token (system accepts any token for now)
5. Click "Create Account"

### 2. Login

1. Use the credentials you just created
2. System will display user info and redirect to dashboard

### 3. Session Persistence

1. Refresh the page (F5)
2. Session persists from localStorage
3. User info shows without re-login

### 4. Token Refresh

1. Wait for access token to expire (16m in dev) OR manually expire by:
   - Opening DevTools Console
   - Run: `localStorage.removeItem('auth-storage')`
   - Refresh page and try API call
2. System automatically refreshes and retries

## File Structure

```
senior-app-3/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   └── auth.js              # Auth logic
│   │   ├── middleware/
│   │   │   └── auth.js              # JWT verification, role checks
│   │   ├── models/
│   │   │   ├── User.js              # User schema
│   │   │   └── RefreshToken.js      # Token rotation tracking
│   │   ├── routes/
│   │   │   └── auth.js              # API routes
│   │   ├── utils/
│   │   │   ├── jwt.js               # Token generation/verification
│   │   │   └── password.js          # Hashing and validation
│   │   └── index.js                 # Express server
│   ├── .env.example
│   ├── package.json
│   └── README.md
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── apiClient.js         # Axios with interceptors
│   │   │   └── authService.js       # Auth API calls
│   │   ├── components/
│   │   │   ├── AuthMethodSelection.js
│   │   │   ├── LoginForm.js
│   │   │   ├── RegisterForm.js
│   │   │   └── ProtectedRoute.js
│   │   ├── store/
│   │   │   └── authStore.js         # Zustand state management
│   │   ├── utils/
│   │   │   └── passwordValidator.js
│   │   ├── App.js                   # Main routing
│   │   └── index.js
│   ├── public/
│   │   └── index.html
│   ├── .env.example
│   ├── package.json
│   └── README.md
│
├── AUTHENTICATION_SETUP.md           # Detailed documentation
└── README.md                          # This file
```

## Authentication Features Implemented

### ✅ Completed
- **Local Authentication**: Email/password login and registration
- **JWT Tokens**: Access token (15m) + Refresh token (7d) with automatic rotation
- **Protected Routes**: Frontend components redirect unauthenticated users to login
- **Global State**: Zustand store persists across page refreshes
- **Token Refresh**: Automatic refresh on 401, retry original request
- **Error Handling**: 401/403 responses handled by HTTP interceptor
- **Session Persistence**: Login persists across browser refresh
- **Password Security**: Bcrypt hashing, strength validation
- **Account Locking**: 5 failed attempts = 30 min lockout
- **Role-Based Access**: Support for student, professor, admin, coordinator
- **Field Validation**: Email format, password strength, form validation

### 🔲 Coming Soon
- GitHub OAuth integration (scaffolding in place)
- Email verification
- Password reset flow
- Student ID validation endpoint
- Professor onboarding
- Account management endpoints

## API Endpoints

### Public Routes
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/register` - Register
- `POST /api/v1/auth/refresh` - Refresh tokens
- `GET /api/v1/auth/github/oauth/callback` - GitHub OAuth callback

### Protected Routes (require Bearer token)
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/github/oauth/initiate` - Initiate GitHub OAuth
- `GET /api/v1/onboarding/accounts/{userId}` - Get user account
- `PATCH /api/v1/onboarding/accounts/{userId}` - Update user account

## Test Credentials

Create your own or use test data:
```
Email: test@university.edu
Password: TestPassword123!
```

## Common Tasks

### Change JWT Expiration Times
Edit `backend/.env`:
```
JWT_EXPIRATION=15m          # Access token lifetime
JWT_REFRESH_EXPIRATION=7d   # Refresh token lifetime
```

### Change Password Requirements
Edit `backend/src/utils/password.js` and `frontend/src/utils/passwordValidator.js`

### Add New Role
1. Update `backend/src/models/User.js` - Add to enum
2. Update `frontend/src/components/ProtectedRoute.js` - Use in requiredRoles

### Enable HTTPS
Update `frontend/.env`:
```
REACT_APP_API_URL=https://api.yourdomain.com/api/v1
```

## Docker Setup (Optional)

### MongoDB with Docker
```bash
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo:latest
```

Update `.env`:
```
MONGODB_URI=mongodb://admin:password@localhost:27017/senior-app?authSource=admin
```

## Debugging

### Frontend Issues
- Open DevTools (F12)
- Check localStorage: `localStorage.getItem('auth-storage')`
- Check Network tab for API responses
- Common logs: `console.log(useAuthStore.getState())`

### Backend Issues
- Check terminal output for errors
- Add debug logging: `console.log('Debug:', variable)`
- Test endpoints with cURL or Postman

## Performance Considerations

- Access tokens (15m) balance security and UX
- Refresh tokens (7d) allow extended sessions
- Token rotation prevents token reuse attacks
- In-memory queue prevents token refresh race conditions

## Security Notes

- ⚠️ Store refresh tokens in HTTP-only cookies for production
- ⚠️ Use HTTPS in production
- ⚠️ Implement rate limiting on auth endpoints
- ⚠️ Add CSRF token validation
- ⚠️ Implement account verification email
- ⚠️ Add 2FA support for sensitive operations

## Next Steps

1. **Integrate Student ID Validation**
   - Create `/onboarding/validate-student-id` endpoint
   - Validate against university database

2. **Add Email Verification**
   - Store verification token in User model
   - Send email with verification link
   - Verify token on `/onboarding/verify-email`

3. **Complete GitHub OAuth**
   - Test OAuth flow with GitHub app
   - Handle OAuth callback and user linking

4. **Build Dashboard**
   - Create protected dashboard component
   - Display user profile information
   - Show project listings

5. **Deployment**
   - Deploy backend to AWS/Azure/Heroku
   - Deploy frontend to Vercel/Netlify
   - Configure environment variables
   - Setup CI/CD pipeline

---

For detailed setup information, see [AUTHENTICATION_SETUP.md](./AUTHENTICATION_SETUP.md)
