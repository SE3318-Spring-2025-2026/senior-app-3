import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ProfilePage from '../pages/ProfilePage';

const mockNavigate = jest.fn();

// Mock react-router navigation
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Simple mutable mock for zustand store selector behavior
jest.mock('../store/authStore', () => {
  let state = { user: null, clearAuth: jest.fn() };
  const fn = (selector) => selector(state);
  fn.setState = (s) => { state = s; };
  return fn;
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('renders empty-state when no user', () => {
  const useAuthStore = require('../store/authStore');
  useAuthStore.setState({ user: null, clearAuth: jest.fn() });
  render(<ProfilePage />);
  expect(screen.getByText(/User information not available/i)).toBeInTheDocument();
});

test('renders user profile and logout', () => {
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

  fireEvent.click(screen.getByText(/Logout/i));
  expect(mockClear).toHaveBeenCalled();
});
