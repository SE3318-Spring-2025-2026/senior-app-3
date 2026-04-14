import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Global auth state management using Zustand
 * Persists auth tokens and user info across page refreshes
 */
const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      requiresPasswordChange: false,
      isLoading: false,
      error: null,

      // Actions
      /**
       * Set user and tokens on successful login/registration
       */
      setAuth: (user, accessToken, refreshToken) => {
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          error: null,
        });
      },

      /**
       * Update access token after refresh
       */
      updateAccessToken: (accessToken) => {
        set({ accessToken });
      },

      /**
       * Update user info
       */
      setUser: (user) => {
        set({ user });
      },

      /**
       * Set requiresPasswordChange flag (for professor forced change flow)
       */
      setRequiresPasswordChange: (value) => {
        set({ requiresPasswordChange: value });
      },

      /**
       * Clear auth on logout or session expiration
       */
      clearAuth: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          requiresPasswordChange: false,
          error: null,
        });
      },

      /**
       * Set loading state
       */
      setLoading: (isLoading) => {
        set({ isLoading });
      },

      /**
       * Set error message
       */
      setError: (error) => {
        set({ error });
      },

      /**
       * Clear error message
       */
      clearError: () => {
        set({ error: null });
      },

      /**
       * Check if session is valid
       */
      isSessionValid: () => {
        const state = get();
        return state.isAuthenticated && state.accessToken;
      },

      /**
       * Get current tokens
       */
      getTokens: () => {
        const state = get();
        return {
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        };
      },
    }),
    {
      name: 'auth-storage', // Name of the storage key
      partialize: (state) => ({
        // Only persist these fields
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        requiresPasswordChange: state.requiresPasswordChange,
      }),
      storage: {
        // Use sessionStorage for more security; alternatively use localStorage
        getItem: (name) => {
          const item = localStorage.getItem(name);
          return item ? JSON.parse(item) : null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);

export default useAuthStore;
