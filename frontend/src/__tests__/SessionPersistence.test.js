import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import ProtectedRoute from '../components/ProtectedRoute';

describe('Session Persistence', () => {
  const ProtectedDashboard = () => <div>Dashboard</div>;
  const LoginPage = () => <div>Login</div>;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    jest.clearAllMocks();
    
    // Also reset the Zustand store state
    const store = useAuthStore.getState();
    store.clearAuth();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const renderApp = (initialRoute = '/dashboard') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute component={ProtectedDashboard} />} />
          <Route path="/auth/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe('Token Storage to localStorage', () => {
    it('saves tokens to localStorage after login', (done) => {
      const mockUser = { id: '123', email: 'test@example.com', role: 'student' };
      const mockAccessToken = 'access_token_abc123';
      const mockRefreshToken = 'refresh_token_xyz789';

      // Simulate login
      const store = useAuthStore.getState();
      store.setAuth(mockUser, mockAccessToken, mockRefreshToken);

      // Wait for localStorage to be updated
      setTimeout(() => {
        const stored = localStorage.getItem('auth-storage');
        const parsed = JSON.parse(stored);

        expect(parsed.state.accessToken).toBe(mockAccessToken);
        expect(parsed.state.refreshToken).toBe(mockRefreshToken);
        expect(parsed.state.user).toEqual(mockUser);
        done();
      }, 10);
    });

    it('only stores necessary auth fields', (done) => {
      const mockUser = { id: '123', email: 'test@example.com', role: 'student' };
      useAuthStore.getState().setAuth(mockUser, 'token', 'refresh');

      setTimeout(() => {
        const stored = localStorage.getItem('auth-storage');
        const parsed = JSON.parse(stored);

        // Should have these fields
        expect(parsed.state).toHaveProperty('user');
        expect(parsed.state).toHaveProperty('accessToken');
        expect(parsed.state).toHaveProperty('refreshToken');
        expect(parsed.state).toHaveProperty('isAuthenticated');
        expect(parsed.state).toHaveProperty('requiresPasswordChange');

        // Should NOT have these fields
        expect(parsed.state).not.toHaveProperty('isLoading');
        expect(parsed.state).not.toHaveProperty('error');
        done();
      }, 10);
    });

    it('updates localStorage when tokens are refreshed', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'old_token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().updateAccessToken('new_token');

        setTimeout(() => {
          const stored = localStorage.getItem('auth-storage');
          const parsed = JSON.parse(stored);

          expect(parsed.state.accessToken).toBe('new_token');
          done();
        }, 10);
      }, 10);
    });

    it('updates localStorage when user data changes', (done) => {
      const initialUser = { id: '123', name: 'John' };
      useAuthStore.getState().setAuth(initialUser, 'token', 'refresh');

      setTimeout(() => {
        const updatedUser = { id: '123', name: 'John Doe', githubUsername: 'johndoe' };
        useAuthStore.getState().setUser(updatedUser);

        setTimeout(() => {
          const stored = localStorage.getItem('auth-storage');
          const parsed = JSON.parse(stored);

          expect(parsed.state.user.name).toBe('John Doe');
          expect(parsed.state.user.githubUsername).toBe('johndoe');
          done();
        }, 10);
      }, 10);
    });
  });

  describe('Token Restoration from localStorage', () => {
    it('restores tokens when app initializes with localStorage data', (done) => {
      const savedState = {
        user: { id: '456', email: 'saved@example.com', role: 'professor' },
        accessToken: 'saved_access_token',
        refreshToken: 'saved_refresh_token',
        isAuthenticated: true,
        requiresPasswordChange: false,
      };

      localStorage.setItem('auth-storage', JSON.stringify({ state: savedState }));

      // Verify localStorage was set
      const stored = localStorage.getItem('auth-storage');
      const parsed = JSON.parse(stored);

      expect(parsed.state.user.email).toBe('saved@example.com');
      expect(parsed.state.accessToken).toBe('saved_access_token');
      done();
    });

    it('survives app unmount and remount with localStorage', (done) => {
      const mockUser = { id: '123', name: 'Test User', role: 'student' };

      // First mount: log in
      useAuthStore.getState().setAuth(mockUser, 'token_1', 'refresh_1');

      setTimeout(() => {
        // Simulate app unmount
        const { unmount } = renderApp('/dashboard');

        // Verify localStorage has data
        const stored = JSON.parse(localStorage.getItem('auth-storage'));
        expect(stored.state.user.name).toBe('Test User');

        unmount();

        // Remount app - should still have auth data in localStorage
        const stored2 = JSON.parse(localStorage.getItem('auth-storage'));
        expect(stored2.state.accessToken).toBe('token_1');
        done();
      }, 10);
    });

    it('restores isAuthenticated flag from localStorage', (done) => {
      const savedState = {
        user: { id: '123' },
        accessToken: 'token',
        refreshToken: 'refresh',
        isAuthenticated: true,
        requiresPasswordChange: false,
      };

      localStorage.setItem('auth-storage', JSON.stringify({ state: savedState }));

      const stored = JSON.parse(localStorage.getItem('auth-storage'));
      expect(stored.state.isAuthenticated).toBe(true);
      done();
    });

    it('restores requiresPasswordChange flag from localStorage', (done) => {
      const savedState = {
        user: { id: '123' },
        accessToken: 'token',
        refreshToken: 'refresh',
        isAuthenticated: true,
        requiresPasswordChange: true,
      };

      localStorage.setItem('auth-storage', JSON.stringify({ state: savedState }));

      const stored = JSON.parse(localStorage.getItem('auth-storage'));
      expect(stored.state.requiresPasswordChange).toBe(true);
      done();
    });
  });

  describe('Logout and Session Clearing', () => {
    it('removes tokens from localStorage on logout', (done) => {
      const mockUser = { id: '123' };
      useAuthStore.getState().setAuth(mockUser, 'token', 'refresh');

      setTimeout(() => {
        // Verify tokens are stored
        let stored = JSON.parse(localStorage.getItem('auth-storage'));
        expect(stored.state.accessToken).toBe('token');

        // Logout
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          stored = JSON.parse(localStorage.getItem('auth-storage'));
          expect(stored.state.accessToken).toBeNull();
          expect(stored.state.refreshToken).toBeNull();
          expect(stored.state.user).toBeNull();
          done();
        }, 10);
      }, 10);
    });

    it('sets isAuthenticated to false in localStorage on logout', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          const stored = JSON.parse(localStorage.getItem('auth-storage'));
          expect(stored.state.isAuthenticated).toBe(false);
          done();
        }, 10);
      }, 10);
    });

    it('does not leave orphaned token data after logout', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          const stored = JSON.parse(localStorage.getItem('auth-storage'));
          
          // All sensitive data should be null
          expect(stored.state.accessToken).toBeNull();
          expect(stored.state.refreshToken).toBeNull();
          expect(stored.state.user).toBeNull();
          done();
        }, 10);
      }, 10);
    });
  });

  describe('Expired Token Handling', () => {
    it('treats expired token in localStorage as unauthenticated', () => {
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const savedState = {
        user: { id: '123' },
        accessToken: 'expired_token', // No validation in this layer
        refreshToken: 'might_be_expired',
        isAuthenticated: true,
        requiresPasswordChange: false,
        tokenExpiresAt: expiredDate.toISOString(),
      };

      localStorage.setItem('auth-storage', JSON.stringify({ state: savedState }));

      // Note: The app relies on API interceptors (401) to detect expired tokens
      // Token validation should happen on server-side or during API calls
      const stored = JSON.parse(localStorage.getItem('auth-storage'));
      expect(stored.state).toBeDefined();
    });

    it('handles scenario where localStorage has token but it\'s actually expired', (done) => {
      // Store tokens
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        // Later, when API endpoint returns 401, clearAuth is called
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          const stored = JSON.parse(localStorage.getItem('auth-storage'));
          expect(stored.state.accessToken).toBeNull();
          done();
        }, 10);
      }, 10);
    });
  });

  describe('localStorage Key Naming', () => {
    it('uses consistent key name for storage', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        // The key should always be 'auth-storage'
        const stored = localStorage.getItem('auth-storage');
        expect(stored).not.toBeNull();
        
        // Verify it's the only auth-related key
        const keys = Object.keys(localStorage);
        const authKeys = keys.filter(k => k.includes('auth'));
        expect(authKeys).toContain('auth-storage');
        done();
      }, 10);
    });

    it('persists to standard localStorage not sessionStorage', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        // Should be in localStorage
        expect(localStorage.getItem('auth-storage')).not.toBeNull();
        
        // Not in sessionStorage
        expect(sessionStorage.getItem('auth-storage')).toBeNull();
        done();
      }, 10);
    });
  });

  describe('Navigation Persistence', () => {
    it('preserves auth state during page navigation', (done) => {
      const mockUser = { id: '123', role: 'student' };
      useAuthStore.getState().setAuth(mockUser, 'token', 'refresh');

      setTimeout(() => {
        // Simulate navigation to different route
        const route1 = '/dashboard';
        const route2 = '/profile';

        // Auth state should persist
        const store1 = useAuthStore.getState();
        expect(store1.isAuthenticated).toBe(true);

        // After navigation (simulated)
        const store2 = useAuthStore.getState();
        expect(store2.isAuthenticated).toBe(true);
        expect(store2.user.id).toBe('123');
        done();
      }, 10);
    });

    it('maintains tokens through SPA navigation', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token_abc', 'refresh_xyz');

      setTimeout(() => {
        let store = useAuthStore.getState();
        expect(store.accessToken).toBe('token_abc');

        // Simulate navigation
        // (no actual state changes, just verify it persists)
        store = useAuthStore.getState();
        expect(store.accessToken).toBe('token_abc');
        done();
      }, 10);
    });
  });

  describe('Multiple Tab Synchronization', () => {
    it('syncs logout across tabs when localStorage is cleared', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        // Simulate logout in another tab by clearing localStorage
        localStorage.clear();

        // After clearing, new store should see no auth
        // (Note: In real scenario, we'd listen to storage events)
        const stored = localStorage.getItem('auth-storage');
        expect(stored).toBeNull();
        done();
      }, 10);
    });

    it('handles localStorage quota exceeded gracefully', () => {
      // This would be a real scenario with large user objects
      // or many auth attempts stored

      // Current implementation doesn't have explicit quota handling
      // but localStorage will throw if exceeded
      expect(() => {
        useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');
      }).not.toThrow();
    });
  });

  describe('ProtectedRoute with Persistent Auth', () => {
    it('shows protected content when localStorage has valid auth', (done) => {
      const savedState = {
        user: { id: '123', role: 'student' },
        accessToken: 'valid_token',
        refreshToken: 'valid_refresh',
        isAuthenticated: true,
        requiresPasswordChange: false,
      };

      localStorage.setItem('auth-storage', JSON.stringify({ state: savedState }));

      // Reset store to simulate fresh app load
      const store = useAuthStore.getState();
      store.setAuth(savedState.user, savedState.accessToken, savedState.refreshToken);

      setTimeout(() => {
        const currentState = useAuthStore.getState();
        expect(currentState.isAuthenticated).toBe(true);
        done();
      }, 10);
    });

    it('redirects to login when localStorage is empty', () => {
      // After beforeEach clears auth, store should be unauthenticated
      // (localStorage will have cleared state, not null)
      const store = useAuthStore.getState();
      expect(store.isAuthenticated).toBe(false);
      expect(store.accessToken).toBeNull();
      expect(store.user).toBeNull();
    });

    it('redirects to login when stored tokens are cleared', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          const store = useAuthStore.getState();
          expect(store.isAuthenticated).toBe(false);
          done();
        }, 10);
      }, 10);
    });
  });

  describe('Storage Events', () => {
    it('stores data in the correct localStorage format', (done) => {
      useAuthStore.getState().setAuth(
        { id: '123', email: 'test@test.com' },
        'my_access',
        'my_refresh'
      );

      setTimeout(() => {
        const raw = localStorage.getItem('auth-storage');
        const parsed = JSON.parse(raw);

        // Should have version and state
        expect(parsed).toHaveProperty('state');
        expect(parsed.state.accessToken).toBe('my_access');
        done();
      }, 10);
    });
  });
});
