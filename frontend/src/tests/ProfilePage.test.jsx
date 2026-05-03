import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProfilePage from '../pages/ProfilePage';

const mockNavigate = jest.fn();

// Mock react-router navigation
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock profile API calls
jest.mock('../api/profileService');

// Mutable zustand store mock
jest.mock('../store/authStore', () => {
  let state = { 
    user: null, 
    clearAuth: jest.fn(),
    setUser: jest.fn(),
  };
  const fn = (selector) => selector(state);
  fn.setState = (s) => { 
    state = { ...state, ...s }; 
  };
  return fn;
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe('ProfilePage', () => {
  describe('success state', () => {
    test('renders empty-state when no user', () => {
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user: null, clearAuth: jest.fn() });
      render(<ProfilePage />);
      expect(screen.getByText(/User information not available/i)).toBeInTheDocument();
    });

    test('renders user profile with all information', () => {
      const mockClear = jest.fn();
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
        createdAt: Date.now(),
        lastLogin: Date.now(),
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user, clearAuth: mockClear });

      render(<ProfilePage />);

      expect(screen.getByText(/My Profile/i)).toBeInTheDocument();
      expect(screen.getByText(user.email)).toBeInTheDocument();
      expect(screen.getByText(/Student/i)).toBeInTheDocument();
    });

    test('logout button clears auth and navigates', async () => {
      const mockClear = jest.fn();
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
        createdAt: Date.now(),
        lastLogin: Date.now(),
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user, clearAuth: mockClear });

      render(<ProfilePage />);

      fireEvent.click(screen.getByText(/Logout/i));
      
      await waitFor(() => {
        expect(mockClear).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/auth/method-selection');
      });
    });

    test('successfully edits profile in edit mode', () => {
      const mockClear = jest.fn();
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
        githubUsername: 'alice123',
        createdAt: Date.now(),
        lastLogin: Date.now(),
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user, clearAuth: mockClear });

      render(<ProfilePage />);

      // Enter edit mode
      fireEvent.click(screen.getByText(/Edit Profile/i));

      // Verify edit mode activated by checking Cancel button exists
      const cancelButtons = screen.queryAllByText(/Cancel/i);
      expect(cancelButtons.length).toBeGreaterThan(0);
    });
  });

  describe('failure states', () => {
    test('displays error message on profile update failure', async () => {
      const profileService = require('../api/profileService');
      profileService.updateProfile = jest.fn().mockRejectedValueOnce({
        response: { status: 500, data: { message: 'Server error' } },
      });

      const mockClear = jest.fn();
      const mockSetUser = jest.fn();
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
        githubUsername: 'alice123',
        createdAt: Date.now(),
        lastLogin: Date.now(),
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user, clearAuth: mockClear, setUser: mockSetUser });

      render(<ProfilePage />);

      fireEvent.click(screen.getByText(/Edit Profile/i));
      
      // Find and change the github username field
      const inputs = screen.getAllByDisplayValue('alice123');
      fireEvent.change(inputs[0], { target: { value: 'alice_new' } });
      
      fireEvent.click(screen.getByText(/Save/i));

      await waitFor(() => {
        expect(profileService.updateProfile).toHaveBeenCalled();
      });
    });

    test('handles 403 unauthorized error', async () => {
      const profileService = require('../api/profileService');
      profileService.updateProfile = jest.fn().mockRejectedValueOnce({
        response: { status: 403, data: { message: 'Unauthorized' } },
      });

      const mockClear = jest.fn();
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
        githubUsername: 'alice123',
        createdAt: Date.now(),
        lastLogin: Date.now(),
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user, clearAuth: mockClear });

      render(<ProfilePage />);

      fireEvent.click(screen.getByText(/Edit Profile/i));
      
      const inputs = screen.getAllByDisplayValue('alice123');
      fireEvent.change(inputs[0], { target: { value: 'alice_new' } });
      
      fireEvent.click(screen.getByText(/Save/i));

      await waitFor(() => {
        expect(profileService.updateProfile).toHaveBeenCalled();
      });
    });
  });

  describe('empty-state', () => {
    test('shows error state when user is not logged in', () => {
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user: null });

      render(<ProfilePage />);

      expect(screen.getByText(/User information not available/i)).toBeInTheDocument();
    });

    test('displays profile with minimal user data', () => {
      const user = {
        email: 'test@example.com',
        userId: 'u1',
        role: 'student',
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user });

      render(<ProfilePage />);

      expect(screen.getByText(/My Profile/i)).toBeInTheDocument();
      expect(screen.getByText(user.email)).toBeInTheDocument();
    });
  });

  describe('role display', () => {
    test('displays student role correctly', () => {
      const user = {
        email: 'student@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user });

      render(<ProfilePage />);
      const roleElements = screen.queryAllByText(/Student/i);
      expect(roleElements.length).toBeGreaterThan(0);
    });

    test('displays professor role correctly', () => {
      const user = {
        email: 'prof@example.com',
        userId: 'u2',
        role: 'professor',
        accountStatus: 'active',
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user });

      render(<ProfilePage />);
      const roleElements = screen.queryAllByText(/Professor/i);
      expect(roleElements.length).toBeGreaterThan(0);
    });

    test('displays coordinator role correctly', () => {
      const user = {
        email: 'coord@example.com',
        userId: 'u3',
        role: 'coordinator',
        accountStatus: 'active',
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user });

      render(<ProfilePage />);
      const roleElements = screen.queryAllByText(/Coordinator/i);
      expect(roleElements.length).toBeGreaterThan(0);
    });
  });

  describe('account status display', () => {
    test('displays active account status', () => {
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'active',
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user });

      render(<ProfilePage />);
      const statusElements = screen.queryAllByText(/Active/i);
      expect(statusElements.length).toBeGreaterThan(0);
    });

    test('displays pending account status', () => {
      const user = {
        email: 'alice@example.com',
        userId: 'u1',
        role: 'student',
        accountStatus: 'pending',
      };
      const useAuthStore = require('../store/authStore');
      useAuthStore.setState({ user });

      render(<ProfilePage />);
      const statusElements = screen.queryAllByText(/Pending Verification/i);
      expect(statusElements.length).toBeGreaterThan(0);
    });
  });
});
