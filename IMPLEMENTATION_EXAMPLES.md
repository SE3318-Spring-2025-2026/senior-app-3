# Authentication System - Implementation Examples

This document provides code examples for using the authentication system.

## Backend Examples

### 1. Using Auth Middleware

```javascript
// routes/projects.js
const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// Protect endpoint - any authenticated user
router.get('/my-projects', authMiddleware, (req, res) => {
  const userId = req.user.userId;
  const userRole = req.user.role;
  
  res.json({
    message: `Projects for user ${userId}`,
    userRole
  });
});

// Protect endpoint - specific roles only
router.delete('/projects/:id', 
  authMiddleware, 
  roleMiddleware(['admin', 'professor']),
  (req, res) => {
    res.json({ message: 'Project deleted' });
  }
);

module.exports = router;
```

### 2. Extending Auth Controller

```javascript
// controllers/auth.js - Adding new functionality

/**
 * Verify email with token
 */
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    
    // Find user with verification token
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired verification token'
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;
    await user.save();

    return res.json({
      userId: user.userId,
      emailVerified: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Email verification failed'
    });
  }
};

module.exports = { verifyEmail };
```

### 3. Custom Role Check

```javascript
// middleware/custom-auth.js

/**
 * Check if user owns the resource or is admin
 */
const checkResourceOwnership = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user;

    if (currentUser.userId !== userId && currentUser.role !== 'admin') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You can only access your own resources'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Authorization check failed'
    });
  }
};

module.exports = { checkResourceOwnership };
```

---

## Frontend Examples

### 1. Creating Protected Components

```javascript
// components/ProjectsList.js
import React, { useEffect, useState } from 'react';
import useAuthStore from '../store/authStore';
import apiClient from '../api/apiClient';

const ProjectsList = () => {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await apiClient.get('/projects/my-projects');
        setProjects(response.data);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      fetchProjects();
    }
  }, [user]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Welcome, {user.email}</h1>
      <div className="projects-grid">
        {projects.map(project => (
          <div key={project.id} className="project-card">
            <h2>{project.name}</h2>
            <p>{project.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectsList;
```

### 2. Using Auth Store in Components

```javascript
// components/UserProfile.js
import React from 'react';
import useAuthStore from '../store/authStore';
import { logoutUser } from '../api/authService';

const UserProfile = () => {
  const { user, clearAuth, refreshToken } = useAuthStore();

  const handleLogout = async () => {
    try {
      await logoutUser(refreshToken);
      clearAuth();
      window.location.href = '/auth/login';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="profile">
      <h2>{user.email}</h2>
      <p>Role: {user.role}</p>
      <p>Status: {user.accountStatus}</p>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default UserProfile;
```

### 3. Protected API Calls

```javascript
// api/projectService.js
import apiClient from './apiClient';

/**
 * Create a new project (requires authentication)
 * 401 handled automatically by interceptor
 */
export const createProject = async (projectData) => {
  const response = await apiClient.post('/projects', projectData);
  return response.data;
};

/**
 * Update project (may fail with 403 if owner/admin check fails)
 */
export const updateProject = async (projectId, updates) => {
  try {
    const response = await apiClient.patch(`/projects/${projectId}`, updates);
    return response.data;
  } catch (error) {
    if (error.response?.status === 403) {
      throw new Error('You do not have permission to update this project');
    }
    throw error;
  }
};

/**
 * Delete project (admin only)
 */
export const deleteProject = async (projectId) => {
  const response = await apiClient.delete(`/projects/${projectId}`);
  return response.data;
};

export default {
  createProject,
  updateProject,
  deleteProject,
};
```

### 4. Form with Auth Integration

```javascript
// components/UpdateProfileForm.js
import React, { useState } from 'react';
import useAuthStore from '../store/authStore';
import apiClient from '../api/apiClient';

const UpdateProfileForm = () => {
  const { user, setUser } = useAuthStore();
  const [formData, setFormData] = useState({
    displayName: user?.displayName || '',
    bio: user?.bio || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.patch(
        `/onboarding/accounts/${user.userId}`,
        formData
      );

      // Update local store
      setUser({ ...user, ...response.data });
      setFormData({ displayName: '', bio: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}
      
      <input
        type="text"
        placeholder="Display Name"
        value={formData.displayName}
        onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
        disabled={loading}
      />
      
      <textarea
        placeholder="Bio"
        value={formData.bio}
        onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
        disabled={loading}
      />
      
      <button type="submit" disabled={loading}>
        {loading ? 'Saving...' : 'Update Profile'}
      </button>
    </form>
  );
};

export default UpdateProfileForm;
```

### 5. Role-Based UI Rendering

```javascript
// components/AdminPanel.js
import React from 'react';
import useAuthStore from '../store/authStore';

const AdminPanel = () => {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const isProfessor = user?.role === 'professor';

  return (
    <div className="admin-panel">
      {isAdmin && (
        <section>
          <h2>Admin Controls</h2>
          <button>Manage Users</button>
          <button>View Reports</button>
          <button>System Settings</button>
        </section>
      )}

      {(isAdmin || isProfessor) && (
        <section>
          <h2>Professor Controls</h2>
          <button>Grade Projects</button>
          <button>Manage Teams</button>
        </section>
      )}

      <section>
        <h2>User Info</h2>
        <p>Email: {user?.email}</p>
        <p>Role: {user?.role}</p>
      </section>
    </div>
  );
};

export default AdminPanel;
```

---

## Advanced Examples

### 1. Error Boundary with Auth

```javascript
// components/ErrorBoundary.js
import React from 'react';
import useAuthStore from '../store/authStore';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Handle 401 errors specially
    if (error.response?.status === 401) {
      const { clearAuth } = useAuthStore.getState();
      clearAuth();
      window.location.href = '/auth/login';
    }

    console.error('Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
```

### 2. Custom Hook for Auth

```javascript
// hooks/useAuth.js
import { useCallback } from 'react';
import useAuthStore from '../store/authStore';
import { logoutUser } from '../api/authService';

export const useAuth = () => {
  const store = useAuthStore();

  const logout = useCallback(async () => {
    try {
      const { refreshToken } = store.getTokens();
      await logoutUser(refreshToken);
    } finally {
      store.clearAuth();
    }
  }, [store]);

  const hasRole = useCallback((roles) => {
    const { user } = store;
    if (!user) return false;

    if (typeof roles === 'string') {
      return user.role === roles;
    }

    return roles.includes(user.role);
  }, [store]);

  return {
    ...store,
    logout,
    hasRole,
  };
};

// Usage in component
const MyComponent = () => {
  const { user, hasRole, logout } = useAuth();

  if (hasRole(['admin', 'professor'])) {
    return <div>Admin/Professor Content</div>;
  }

  return <div>Student Content</div>;
};
```

### 3. API Call with Retry Logic

```javascript
// utils/apiRetry.js
export const withRetry = async (fn, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }

      if (error.response?.status === 429) {
        // Rate limited - exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, delay * Math.pow(2, i))
        );
      } else if (error.response?.status !== 401) {
        // Don't retry on 401 - interceptor handles it
        throw error;
      }
    }
  }
};

// Usage
import { withRetry } from '../utils/apiRetry';

const fetchData = async () => {
  return withRetry(
    () => apiClient.get('/data'),
    3,
    1000
  );
};
```

---

## Testing Examples

### Unit Test - Auth Store

```javascript
// __tests__/authStore.test.js
import useAuthStore from '../store/authStore';

describe('Auth Store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  test('setAuth stores user and tokens', () => {
    const user = { userId: 'usr_123', email: 'test@test.com', role: 'student' };
    useAuthStore.getState().setAuth(user, 'access_token', 'refresh_token');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('access_token');
    expect(state.isAuthenticated).toBe(true);
  });

  test('clearAuth removes user and tokens', () => {
    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });
});
```

### Integration Test - Login Flow

```javascript
// __tests__/auth.integration.test.js
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginForm from '../components/LoginForm';
import * as authService from '../api/authService';

jest.mock('../api/authService');

test('Login form submits and updates store', async () => {
  authService.loginUser.mockResolvedValue({
    userId: 'usr_123',
    email: 'test@test.com',
    role: 'student',
    accessToken: 'token123',
    refreshToken: 'refresh123',
  });

  render(<LoginForm />);

  const emailInput = screen.getByPlaceholderText(/email/i);
  const passwordInput = screen.getByPlaceholderText(/password/i);
  const submitButton = screen.getByText(/sign in/i);

  fireEvent.change(emailInput, { target: { value: 'test@test.com' } });
  fireEvent.change(passwordInput, { target: { value: 'Password123!' } });
  fireEvent.click(submitButton);

  await waitFor(() => {
    expect(authService.loginUser).toHaveBeenCalledWith('test@test.com', 'Password123!');
  });
});
```

---

## Troubleshooting Common Issues

### Issue: Token Refresh Loop

```javascript
// Problem: Infinite token refresh attempts
// Solution: Add circuit breaker

if (isRefreshing && retryCount > 3) {
  // Force logout after 3 refresh attempts
  useAuthStore.getState().clearAuth();
  window.location.href = '/auth/login';
  return Promise.reject(new Error('Too many refresh attempts'));
}
```

### Issue: CORS Errors

```javascript
// Problem: Cross-origin requests failing
// Solution: Configure backend CORS

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

### Issue: Stale Auth State

```javascript
// Problem: Auth state not updating after logout
// Solution: Clear localStorage explicitly

export const logout = () => {
  const { clearAuth } = useAuthStore.getState();
  localStorage.removeItem('auth-storage');
  clearAuth();
  window.location.href = '/auth/login';
};
```

---

For more information, see:
- [AUTHENTICATION_SETUP.md](./AUTHENTICATION_SETUP.md) - Detailed setup guide
- [README.md](./README.md) - Quick start guide
- Backend: [backend/src](./backend/src) - Source code
- Frontend: [frontend/src](./frontend/src) - Source code
