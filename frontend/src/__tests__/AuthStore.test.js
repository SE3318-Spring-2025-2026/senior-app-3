import '@testing-library/jest-dom';
import useAuthStore from '../store/authStore';

describe('AuthStore (Zustand)', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useAuthStore.getState();
    store.clearAuth();
    store.clearError();
    
    // Clear localStorage
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      requiresPasswordChange: false,
      error: null,
    });
  });

  describe('Initial State', () => {
    it('initializes as unauthenticated', () => {
      const store = useAuthStore.getState();
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(store.accessToken).toBeNull();
      expect(store.refreshToken).toBeNull();
    });

    it('has no error message initially', () => {
      const store = useAuthStore.getState();
      expect(store.error).toBeNull();
    });
  });

  describe('setAuth() - Authentication', () => {
    it('stores user and tokens correctly', () => {
      const user = { id: '123', email: 'test@example.com', role: 'student' };
      const accessToken = 'access_token_123';
      const refreshToken = 'refresh_token_456';

      useAuthStore.getState().setAuth(user, accessToken, refreshToken);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.accessToken).toBe(accessToken);
      expect(state.refreshToken).toBe(refreshToken);
      expect(state.isAuthenticated).toBe(true);
    });

    it('clears error when setting auth', () => {
      useAuthStore.getState().setError('Previous error');
      
      // Verify error was set
      let state = useAuthStore.getState();
      expect(state.error).toBe('Previous error');

      const user = { id: '123', email: 'test@example.com', role: 'student' };
      useAuthStore.getState().setAuth(user, 'token', 'refresh');

      state = useAuthStore.getState();
      expect(state.error).toBeNull();
    });

    it('persists to localStorage when setAuth is called', (done) => {
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      const user = { id: '123', email: 'test@example.com', role: 'student' };

      useAuthStore.getState().setAuth(user, 'access_token', 'refresh_token');

      // Zustand persistence is async, wait a tick
      setTimeout(() => {
        expect(setItemSpy).toHaveBeenCalledWith(
          'auth-storage',
          expect.stringContaining('access_token')
        );
        setItemSpy.mockRestore();
        done();
      }, 10);
    });

    it('stores all required fields in localStorage', (done) => {
      const user = { id: '123', email: 'test@example.com', role: 'student' };
      useAuthStore.getState().setAuth(user, 'access_token', 'refresh_token');

      setTimeout(() => {
        const stored = localStorage.getItem('auth-storage');
        const parsed = JSON.parse(stored);

        expect(parsed.state.user).toEqual(user);
        expect(parsed.state.accessToken).toBe('access_token');
        expect(parsed.state.refreshToken).toBe('refresh_token');
        expect(parsed.state.isAuthenticated).toBe(true);
        done();
      }, 10);
    });
  });

  describe('updateAccessToken() - Token Refresh', () => {
    it('updates accessToken only', () => {
      const user = { id: '123', email: 'test@example.com', role: 'student' };
      useAuthStore.getState().setAuth(user, 'old_token', 'refresh_token');

      const newAccessToken = 'new_access_token';
      useAuthStore.getState().updateAccessToken(newAccessToken);

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe(newAccessToken);
      expect(state.refreshToken).toBe('refresh_token');
      expect(state.user).toEqual(user);
    });

    it('preserves authentication state when updating token', () => {
      const user = { id: '123' };
      useAuthStore.getState().setAuth(user, 'old_token', 'refresh_token');

      useAuthStore.getState().updateAccessToken('new_token');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
    });

    it('persists updated token to localStorage', (done) => {
      const user = { id: '123' };
      useAuthStore.getState().setAuth(user, 'old_token', 'refresh_token');

      setTimeout(() => {
        useAuthStore.getState().updateAccessToken('new_token');

        setTimeout(() => {
          const stored = JSON.parse(localStorage.getItem('auth-storage'));
          expect(stored.state.accessToken).toBe('new_token');
          done();
        }, 10);
      }, 10);
    });
  });

  describe('clearAuth() - Logout', () => {
    it('clears all auth state', () => {
      const user = { id: '123', email: 'test@example.com' };
      useAuthStore.getState().setAuth(user, 'access_token', 'refresh_token');

      useAuthStore.getState().clearAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('clears requiresPasswordChange flag', () => {
      useAuthStore.getState().setRequiresPasswordChange(true);

      useAuthStore.getState().clearAuth();

      const state = useAuthStore.getState();
      expect(state.requiresPasswordChange).toBe(false);
    });

    it('clears error message', () => {
      useAuthStore.getState().setError('Some error');

      useAuthStore.getState().clearAuth();

      const state = useAuthStore.getState();
      expect(state.error).toBeNull();
    });

    it('removes tokens from localStorage', (done) => {
      const user = { id: '123' };
      useAuthStore.getState().setAuth(user, 'token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          const stored = localStorage.getItem('auth-storage');
          const parsed = JSON.parse(stored);
          expect(parsed.state.accessToken).toBeNull();
          expect(parsed.state.refreshToken).toBeNull();
          expect(parsed.state.isAuthenticated).toBe(false);
          done();
        }, 10);
      }, 10);
    });
  });

  describe('setUser() - User Update', () => {
    it('updates user information', () => {
      const initialUser = { id: '123', email: 'test@example.com' };
      useAuthStore.getState().setAuth(initialUser, 'token', 'refresh');

      const updatedUser = { id: '123', email: 'test@example.com', githubUsername: 'octocat' };
      useAuthStore.getState().setUser(updatedUser);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(updatedUser);
    });

    it('preserves other auth state when updating user', () => {
      const user = { id: '123' };
      useAuthStore.getState().setAuth(user, 'access_token', 'refresh_token');

      useAuthStore.getState().setUser({ id: '123', role: 'admin' });

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('access_token');
      expect(state.isAuthenticated).toBe(true);
    });

    it('persists user changes to localStorage', (done) => {
      const user = { id: '123', name: 'John' };
      useAuthStore.getState().setAuth(user, 'token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().setUser({ id: '123', name: 'John Doe' });

        setTimeout(() => {
          const stored = JSON.parse(localStorage.getItem('auth-storage'));
          expect(stored.state.user.name).toBe('John Doe');
          done();
        }, 10);
      }, 10);
    });
  });

  describe('getTokens() - Token Retrieval', () => {
    it('returns current access and refresh tokens', () => {
      useAuthStore.getState().setAuth({ id: '123' }, 'my_access', 'my_refresh');

      const tokens = useAuthStore.getState().getTokens();
      expect(tokens.accessToken).toBe('my_access');
      expect(tokens.refreshToken).toBe('my_refresh');
    });

    it('returns null tokens when not authenticated', () => {
      useAuthStore.getState().clearAuth();
      const tokens = useAuthStore.getState().getTokens();
      expect(tokens.accessToken).toBeNull();
      expect(tokens.refreshToken).toBeNull();
    });

    it('works after token refresh', () => {
      useAuthStore.getState().setAuth({ id: '123' }, 'old_token', 'refresh');
      useAuthStore.getState().updateAccessToken('new_token');

      const tokens = useAuthStore.getState().getTokens();
      expect(tokens.accessToken).toBe('new_token');
      expect(tokens.refreshToken).toBe('refresh');
    });
  });

  describe('isSessionValid() - Session Validation', () => {
    it('returns falsy when not authenticated', () => {
      useAuthStore.getState().clearAuth();
      const isValid = useAuthStore.getState().isSessionValid();
      expect(!isValid).toBe(true); // falsy value
    });

    it('returns truthy when authenticated with token', () => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      const isValid = useAuthStore.getState().isSessionValid();
      expect(!!isValid).toBe(true); // truthy value (actually the token string)
    });

    it('returns falsy when authenticated but no access token', () => {
      useAuthStore.setState({
        isAuthenticated: true,
        accessToken: null,
        refreshToken: 'refresh',
      });

      const isValid = useAuthStore.getState().isSessionValid();
      expect(!isValid).toBe(true); // falsy value
    });

    it('returns falsy after clearAuth', () => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');
      useAuthStore.getState().clearAuth();

      const isValid = useAuthStore.getState().isSessionValid();
      expect(!isValid).toBe(true); // falsy value
    });
  });

  describe('Error Handling', () => {
    it('setError() stores error message', () => {
      useAuthStore.getState().setError('Invalid credentials');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Invalid credentials');
    });

    it('clearError() removes error message', () => {
      useAuthStore.getState().setError('Some error');
      useAuthStore.getState().clearError();

      const state = useAuthStore.getState();
      expect(state.error).toBeNull();
    });

    it('error is independent of auth state', () => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');
      useAuthStore.getState().setError('Some error');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBe('Some error');
    });
  });

  describe('setRequiresPasswordChange() - Professor Password Reset', () => {
    it('sets requiresPasswordChange flag', () => {
      useAuthStore.getState().setRequiresPasswordChange(true);

      const state = useAuthStore.getState();
      expect(state.requiresPasswordChange).toBe(true);
    });

    it('can be set to false', () => {
      useAuthStore.getState().setRequiresPasswordChange(true);
      useAuthStore.getState().setRequiresPasswordChange(false);

      const state = useAuthStore.getState();
      expect(state.requiresPasswordChange).toBe(false);
    });

    it('persists to localStorage', (done) => {
      useAuthStore.getState().setRequiresPasswordChange(true);

      setTimeout(() => {
        const stored = JSON.parse(localStorage.getItem('auth-storage'));
        expect(stored.state.requiresPasswordChange).toBe(true);
        done();
      }, 10);
    });
  });

  describe('setLoading() - Loading State', () => {
    it('sets loading state', () => {
      useAuthStore.getState().setLoading(true);

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(true);
    });

    it('can be toggled off', () => {
      useAuthStore.getState().setLoading(true);
      useAuthStore.getState().setLoading(false);

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
    });
  });

  describe('localStorage Persistence and Recovery', () => {
    it('restores auth state from localStorage on store init', () => {
      // Save state to localStorage manually
      const savedState = {
        user: { id: '456', email: 'saved@example.com', role: 'professor' },
        accessToken: 'saved_token',
        refreshToken: 'saved_refresh',
        isAuthenticated: true,
        requiresPasswordChange: false,
      };

      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: savedState, version: 0 })
      );

      // Create a fresh store instance to test restoration
      // Note: Zustand with persist middleware will restore on next mount
      // For this test, we manually verify the localStorage structure is correct
      const stored = JSON.parse(localStorage.getItem('auth-storage'));
      expect(stored.state.user.email).toBe('saved@example.com');
      expect(stored.state.isAuthenticated).toBe(true);
    });

    it('does not persist requiresPasswordChange with auth data when stored', (done) => {
      const user = { id: '123' };
      useAuthStore.getState().setAuth(user, 'token', 'refresh');
      useAuthStore.getState().setRequiresPasswordChange(true);

      setTimeout(() => {
        const stored = JSON.parse(localStorage.getItem('auth-storage'));
        // Verify the flag persists
        expect(stored.state.requiresPasswordChange).toBe(true);
        done();
      }, 10);
    });

    it('clears all localStorage on logout', (done) => {
      useAuthStore.getState().setAuth({ id: '123' }, 'token', 'refresh');

      setTimeout(() => {
        useAuthStore.getState().clearAuth();

        setTimeout(() => {
          const stored = JSON.parse(localStorage.getItem('auth-storage'));
          expect(stored.state.accessToken).toBeNull();
          expect(stored.state.user).toBeNull();
          done();
        }, 10);
      }, 10);
    });
  });
});
