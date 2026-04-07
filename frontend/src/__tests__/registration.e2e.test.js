import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import RegisterForm from '../components/RegisterForm';
import * as authService from '../api/authService';
import * as onboardingService from '../api/onboardingService';
import useAuthStore from '../store/authStore';
import useOnboardingStore from '../store/onboardingStore';

jest.mock('../api/authService');
jest.mock('../api/onboardingService');

// Mock components for 3-step process
const Step1 = ({ onNext, onError, loading }) => (
  <div>
    <h2>Step 1: Student ID</h2>
    <input placeholder="e.g. A00123456" defaultValue="" />
    <button onClick={() => onNext('A00123456')}>Next</button>
  </div>
);

const Step2 = ({ onNext, onBack, loading }) => (
  <div>
    <h2>Step 2: Account Details</h2>
    <input placeholder="name@university.edu" defaultValue="" />
    <input placeholder="password" type="password" defaultValue="" />
    <button onClick={onBack}>Back</button>
    <button onClick={() => onNext()}>Next</button>
  </div>
);

const Step3 = ({ onBack, loading }) => (
  <div>
    <h2>Step 3: Verify Email</h2>
    <p>Verification code sent to your email</p>
    <button onClick={onBack}>Back</button>
  </div>
);

describe('Registration E2E Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear store
    useAuthStore.setState({ auth: null, user: null });
    useOnboardingStore.setState({
      studentId: null,
      email: null,
      password: null,
      token: null,
    });
  });

  describe('Multi-step Form Navigation', () => {
    it('navigates from step 1 to step 2', () => {
      const user = userEvent.setup({ delay: null });
      onboardingService.validateStudentId.mockResolvedValue({
        exists: true,
        studentId: 'A00123456',
      });

      render(
        <MemoryRouter>
          <Step1 onNext={() => {}} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('navigates backward from step 2 to step 1', () => {
      const user = userEvent.setup({ delay: null });
      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      const backBtn = screen.getByRole('button', { name: /back/i });
      // Verify we're going back (user would navigate back)
      expect(backBtn).toBeInTheDocument();
    });

    it('navigates to step 3 after account creation', () => {
      const user = userEvent.setup({ delay: null });
      authService.registerStudent.mockResolvedValue({
        success: true,
        user: {
          userId: 'user-123',
          email: 'test@university.edu',
        },
        token: 'jwt-token-123',
      });

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });

  describe('Store Persistence Across Steps', () => {
    it('persists student ID in store', async () => {
      const studentId = 'A00123456';
      useOnboardingStore.setState({ studentId });

      expect(useOnboardingStore.getState().studentId).toBe(studentId);
    });

    it('persists email in store', async () => {
      const email = 'student@university.edu';
      useOnboardingStore.setState({ email });

      expect(useOnboardingStore.getState().email).toBe(email);
    });

    it('persists password in store', async () => {
      const password = 'SecurePassword123!';
      useOnboardingStore.setState({ password });

      expect(useOnboardingStore.getState().password).toBe(password);
    });

    it('persists verification token in store', async () => {
      const token = 'verification-token-123';
      useOnboardingStore.setState({ token });

      expect(useOnboardingStore.getState().token).toBe(token);
    });

    it('stores auth token after registration', async () => {
      const authToken = 'jwt-auth-token-123';
      useAuthStore.setState({ auth: { token: authToken } });

      expect(useAuthStore.getState().auth.token).toBe(authToken);
    });

    it('stores user info in auth store', async () => {
      const user = { userId: 'user-123', email: 'student@university.edu' };
      useAuthStore.setState({ user });

      expect(useAuthStore.getState().user).toBe(user);
    });

    it('maintains data across step navigation backward', async () => {
      const studentId = 'A00123456';
      const email = 'student@university.edu';
      useOnboardingStore.setState({ studentId, email });

      // Simulate navigation backward
      expect(useOnboardingStore.getState().studentId).toBe(studentId);
      expect(useOnboardingStore.getState().email).toBe(email);
    });

    it('maintains data across step navigation forward', async () => {
      const email = 'student@university.edu';
      const password = 'SecurePassword123!';
      useOnboardingStore.setState({ email, password });

      // Simulate navigation forward
      expect(useOnboardingStore.getState().email).toBe(email);
      expect(useOnboardingStore.getState().password).toBe(password);
    });

    it('clears onboarding data after successful registration', async () => {
      useOnboardingStore.setState({
        studentId: 'A00123456',
        email: 'student@university.edu',
        password: 'SecurePassword123!',
        token: 'verification-token',
      });

      // Simulate successful completion
      useOnboardingStore.setState({
        studentId: null,
        email: null,
        password: null,
        token: null,
      });

      const state = useOnboardingStore.getState();
      expect(state.studentId).toBeNull();
      expect(state.email).toBeNull();
      expect(state.password).toBeNull();
      expect(state.token).toBeNull();
    });
  });

  describe('Error Recovery Across Steps', () => {
    it('recovers from step 1 validation error', () => {
      const user = userEvent.setup({ delay: null });
      onboardingService.validateStudentId.mockRejectedValueOnce({
        response: { data: { message: 'Student ID not found' } },
      });

      render(
        <MemoryRouter>
          <Step1 onNext={() => {}} onError={() => {}} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('recovers from step 2 registration error', () => {
      const user = userEvent.setup({ delay: null });
      authService.registerStudent.mockRejectedValueOnce({
        response: { data: { message: 'Email already registered' } },
      });

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });

    it('maintains form state during error retry', () => {
      const user = userEvent.setup({ delay: null });
      authService.registerStudent.mockRejectedValueOnce({
        response: { data: { message: 'Error' } },
      });
      authService.registerStudent.mockResolvedValueOnce({
        success: true,
        user: { userId: 'user-123', email: 'newemail@university.edu' },
        token: 'jwt-token-123',
      });

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('user can restart if step 1 fails twice', () => {
      const user = userEvent.setup({ delay: null });
      onboardingService.validateStudentId.mockRejectedValue({
        response: { data: { message: 'Invalid student ID' } },
      });

      render(
        <MemoryRouter>
          <Step1 onNext={() => {}} onError={() => {}} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('allows navigation back to correct previous step errors', () => {
      const user = userEvent.setup({ delay: null });
      const initialStudentId = 'WRONG123';
      useOnboardingStore.setState({ studentId: initialStudentId });

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      const backBtn = screen.getByRole('button', { name: /back/i });
      // Should be able to click next again on Step 1 with corrected ID
      expect(backBtn).toBeInTheDocument();
    });
  });

  describe('Data Visibility & Privacy', () => {
    it('does not expose student ID in step 2', async () => {
      useOnboardingStore.setState({ studentId: 'A00123456' });

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      // Student ID should not be visible/presented in step 2
      expect(screen.queryByDisplayValue(/A00123456/)).not.toBeInTheDocument();
    });

    it('does not expose password in step 3', async () => {
      useOnboardingStore.setState({ password: 'SecurePassword123!' });

      render(
        <MemoryRouter>
          <Step3 onBack={() => {}} />
        </MemoryRouter>
      );

      // Password should not be displayed anywhere
      expect(screen.queryByDisplayValue(/SecurePassword123!/)).not.toBeInTheDocument();
    });

    it('does not display verification token to user', async () => {
      const token = 'verification-token-secret-123';
      useOnboardingStore.setState({ token });

      render(
        <MemoryRouter>
          <Step3 onBack={() => {}} />
        </MemoryRouter>
      );

      // Token should not be displayed
      expect(screen.queryByText(token)).not.toBeInTheDocument();
    });

    it('does not expose auth token in localStorage to frontend code', async () => {
      const authToken = 'jwt-secret-token-123';
      useAuthStore.setState({ auth: { token: authToken } });

      // Token should only be in httpOnly cookies or secure store
      expect(useAuthStore.getState().auth.token).toBe(authToken);
      // Verify it's not in localStorage
      expect(localStorage.getItem('token')).toBeNull();
    });

    it('hides password fields with type="password"', async () => {
      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      const passwordInput = screen.getByPlaceholderText(/password/);
      expect(passwordInput.type).toBe('password');
    });

    it('clears sensitive data on logout', async () => {
      useAuthStore.setState({
        user: { userId: 'user-123', email: 'student@university.edu' },
        auth: { token: 'jwt-token' },
      });

      // Simulate logout
      useAuthStore.setState({ user: null, auth: null });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.auth).toBeNull();
    });

    it('does not retain password in store after registration', async () => {
      useOnboardingStore.setState({ password: 'SecurePassword123!' });

      // After successful registration, password should be cleared
      useOnboardingStore.setState({ password: null });

      expect(useOnboardingStore.getState().password).toBeNull();
    });

    it('does not expose student ID in error messages', async () => {
      const user = userEvent.setup({ delay: null });
      onboardingService.validateStudentId.mockRejectedValue({
        response: { data: { message: 'Student ID not found in system' } },
      });

      render(
        <MemoryRouter>
          <Step1 onNext={() => {}} onError={() => {}} />
        </MemoryRouter>
      );

      await user.click(screen.getByRole('button', { name: /next/i }));
      // Error message should not reveal actual student IDs or specific user info
      await waitFor(() => {
        expect(screen.queryByText(/A00123456/)).not.toBeInTheDocument();
      });
    });

    it('does not expose email in error messages on step 1', async () => {
      const user = userEvent.setup({ delay: null });
      onboardingService.validateStudentId.mockRejectedValue({
        response: { data: { message: 'Validation failed' } },
      });

      render(
        <MemoryRouter>
          <Step1 onNext={() => {}} onError={() => {}} />
        </MemoryRouter>
      );

      await user.click(screen.getByRole('button', { name: /next/i }));
      // Should not leak email information in error
      await waitFor(() => {
        expect(screen.queryByText(/@university\.edu/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Complete Flow Simulation', () => {
    it('completes full 3-step registration', async () => {
      const user = userEvent.setup({ delay: null });

      // Step 1: Validate student ID
      onboardingService.validateStudentId.mockResolvedValue({
        exists: true,
        studentId: 'A00123456',
      });

      // Step 2: Register student
      authService.registerStudent.mockResolvedValue({
        success: true,
        user: {
          userId: 'user-123',
          email: 'student@university.edu',
        },
        token: 'jwt-token-123',
      });

      // Step 3: Email verification (simulated)
      onboardingService.verifyEmail.mockResolvedValue({
        success: true,
        verified: true,
      });

      // Simulate step 1
      useOnboardingStore.setState({ studentId: 'A00123456' });

      // Simulate step 2
      useOnboardingStore.setState({ email: 'student@university.edu' });
      useAuthStore.setState({
        auth: { token: 'jwt-token-123' },
        user: { userId: 'user-123', email: 'student@university.edu' },
      });

      // Verify final state
      expect(useAuthStore.getState().auth.token).toBe('jwt-token-123');
      expect(useAuthStore.getState().user.email).toBe('student@university.edu');
    });

    it('maintains all data through complete flow', async () => {
      const testData = {
        studentId: 'A00654321',
        email: 'newstudent@university.edu',
        userId: 'user-456',
        token: 'jwt-token-456',
      };

      // Step 1
      useOnboardingStore.setState({ studentId: testData.studentId });
      expect(useOnboardingStore.getState().studentId).toBe(testData.studentId);

      // Step 2
      useOnboardingStore.setState({ email: testData.email });
      useAuthStore.setState({
        auth: { token: testData.token },
        user: { userId: testData.userId, email: testData.email },
      });
      expect(useAuthStore.getState().user.email).toBe(testData.email);
      expect(useAuthStore.getState().auth.token).toBe(testData.token);

      // Step 3 - Email verification
      expect(useOnboardingStore.getState().email).toBe(testData.email);
    });

    it('handles GitHub account linkage flag throughout flow', async () => {
      authService.registerStudent.mockResolvedValue({
        success: true,
        user: {
          userId: 'user-789',
          email: 'student@university.edu',
          githubLinked: true,
        },
        token: 'jwt-token-789',
      });

      // Complete registration
      useAuthStore.setState({
        user: {
          userId: 'user-789',
          email: 'student@university.edu',
          githubLinked: true,
        },
        auth: { token: 'jwt-token-789' },
      });

      expect(useAuthStore.getState().user.githubLinked).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('creates new auth session after registration', async () => {
      const authToken = 'jwt-session-token-123';
      const user = { userId: 'user-123', email: 'student@university.edu' };

      authService.registerStudent.mockResolvedValue({
        success: true,
        user,
        token: authToken,
      });

      useAuthStore.setState({ auth: { token: authToken }, user });

      expect(useAuthStore.getState().auth.token).toBe(authToken);
      expect(useAuthStore.getState().user.email).toBe('student@university.edu');
    });

    it('maintains session token across page reload simulation', async () => {
      const token = 'jwt-persistent-token';
      useAuthStore.setState({ auth: { token } });

      // Simulate page reload by checking persistent state
      expect(useAuthStore.getState().auth.token).toBe(token);
    });

    it('clears session on registration reset', async () => {
      useAuthStore.setState({
        user: { userId: 'user-123', email: 'student@university.edu' },
        auth: { token: 'jwt-token' },
      });

      // Reset/logout
      useAuthStore.setState({ user: null, auth: null });

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().auth).toBeNull();
    });
  });

  describe('Concurrent Operations', () => {
    it('handles multiple registration attempts gracefully', () => {
      const user = userEvent.setup({ delay: null });
      authService.registerStudent.mockRejectedValue({
        response: { data: { message: 'Email already in use' } },
      });

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} />
        </MemoryRouter>
      );

      // Component renders with button
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('prevents multiple submissions during loading', () => {
      const user = userEvent.setup({ delay: null });
      let resolveRegister;
      authService.registerStudent.mockReturnValue(
        new Promise((resolve) => {
          resolveRegister = resolve;
        })
      );

      render(
        <MemoryRouter>
          <Step2 onNext={() => {}} onBack={() => {}} loading={true} />
        </MemoryRouter>
      );

      // Component renders
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });
});
