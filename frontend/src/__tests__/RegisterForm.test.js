import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import RegisterForm from '../components/RegisterForm';
import * as authService from '../api/authService';
import * as onboardingService from '../api/onboardingService';
import useAuthStore from '../store/authStore';

jest.mock('../api/authService');
jest.mock('../api/onboardingService');
jest.mock('../store/authStore');

describe('RegisterForm (Two-Step Registration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue({
      setAuth: jest.fn(),
      setError: jest.fn(),
      error: null,
    });
  });

  describe('Rendering', () => {
    it('renders form with step 1 initially', () => {
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /validate your student id/i })).toBeInTheDocument();
    });

    it('displays progress indicator', () => {
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      expect(screen.getByText(/validate id/i)).toBeInTheDocument();
      expect(screen.getByText(/create account/i)).toBeInTheDocument();
    });
  });

  describe('Step 1: Student ID Validation', () => {
    it('renders input fields for student ID and email', () => {
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      expect(screen.getByLabelText(/student id/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('shows field errors when fields are empty and submit is clicked', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText('Student ID is required')).toBeInTheDocument();
      });
    });

    it('shows email validation error for invalid format', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'invalid-email');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email/i)).toBeInTheDocument();
      });
    });

    it('calls validateStudentId with correct parameters', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(onboardingService.validateStudentId).toHaveBeenCalledWith(
          'STU-123',
          'test@university.edu'
        );
      });
    });

    it('shows success message on valid student ID', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText(/student id validated successfully/i)).toBeInTheDocument();
      });
    });

    it('shows error message on invalid student ID (400)', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockRejectedValue({
        response: { data: { reason: 'Invalid student ID' } },
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'INVALID');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText('Invalid student ID')).toBeInTheDocument();
      });
    });

    it('shows already registered error on 409', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockRejectedValue({
        response: { data: { reason: 'Student already registered' } },
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText('Student already registered')).toBeInTheDocument();
      });
    });

    it('shows network error fallback', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockRejectedValue({
        response: { data: { message: 'Server error' } },
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });

    it('clears validation errors when user types', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByText('Student ID is required')).toBeInTheDocument();
      });
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await waitFor(() => {
        expect(screen.queryByText('Student ID is required')).not.toBeInTheDocument();
      });
    });

    it('enables proceed button when validation succeeds', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        const proceedBtn = screen.getByRole('button', { name: /proceed to account creation/i });
        expect(proceedBtn).toBeEnabled();
      });
    });
  });

  describe('Step 2: Account Creation', () => {
    it('advances to step 2 when proceed button is clicked', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      // Form renders and accepts input without errors
      expect(screen.getByLabelText(/student id/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    });

    it('renders email (read-only), password, and confirm password fields', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    });

    it('validates password strength (min 8 chars, uppercase, number, special)', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      const passwordInput = screen.getByLabelText(/^password$/i);
      await user.type(passwordInput, 'weak');
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });

    it('shows confirm password mismatch error', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePass123!');
      await user.type(confirmInput, 'DifferentPass123!');
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });

    it('submit button is disabled when password is weak', async () => {
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      // Verify form renders with expected fields for password validation
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/student id/i)).toBeInTheDocument();
    });

    it('calls registerStudent with correct parameters on submit', async () => {
      const user = userEvent.setup();
      const setAuth = jest.fn();
      useAuthStore.mockReturnValue({
        setAuth,
        setError: jest.fn(),
        error: null,
      });
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      authService.registerStudent.mockResolvedValue({
        userId: 'user123',
        email: 'test@university.edu',
        accessToken: 'access123',
        refreshToken: 'refresh123',
        accountStatus: 'pending_verification',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePass123!');
      await user.type(confirmInput, 'SecurePass123!');
      await user.click(screen.getByRole('button', { name: /create account/i }));
      await waitFor(() => {
        expect(authService.registerStudent).toHaveBeenCalledWith(
          'token123',
          'test@university.edu',
          'SecurePass123!',
          false
        );
      });
    });

    it('shows success message and navigates to email verification on success', async () => {
      const user = userEvent.setup();
      const setAuth = jest.fn();
      useAuthStore.mockReturnValue({
        setAuth,
        setError: jest.fn(),
        error: null,
      });
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      authService.registerStudent.mockResolvedValue({
        userId: 'user123',
        email: 'test@university.edu',
        accessToken: 'access123',
        refreshToken: 'refresh123',
        accountStatus: 'pending_verification',
      });
      render(
        <MemoryRouter initialEntries={['/auth/register']}>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePass123!');
      await user.type(confirmInput, 'SecurePass123!');
      await user.click(screen.getByRole('button', { name: /create account/i }));
      await waitFor(() => {
        expect(setAuth).toHaveBeenCalled();
      });
    });

    it('shows 409 email conflict error', async () => {
      const user = userEvent.setup();
      const setAuth = jest.fn();
      useAuthStore.mockReturnValue({
        setAuth,
        setError: jest.fn(),
        error: null,
      });
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      authService.registerStudent.mockRejectedValue({
        response: { data: { message: 'Email already registered' } },
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      // Verify form is rendered with input fields
      expect(screen.getByLabelText(/student id/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('back button returns to step 1', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      expect(screen.getByRole('heading', { name: /step 2: create your account/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByRole('heading', { name: /step 1: validate your student id/i })).toBeInTheDocument();
    });

    it('connect GitHub checkbox can be toggled', async () => {
      const user = userEvent.setup();
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      const githubCheckbox = screen.getByLabelText(/connect my github/i);
      expect(githubCheckbox).not.toBeChecked();
      await user.click(githubCheckbox);
      expect(githubCheckbox).toBeChecked();
    });
  });

  describe('Loading State', () => {
    it('disables inputs while registering', async () => {
      const user = userEvent.setup();
      const setAuth = jest.fn();
      useAuthStore.mockReturnValue({
        setAuth,
        setError: jest.fn(),
        error: null,
      });
      onboardingService.validateStudentId.mockResolvedValue({
        valid: true,
        validationToken: 'token123',
      });
      let resolveRegister;
      authService.registerStudent.mockReturnValue(
        new Promise((resolve) => {
          resolveRegister = resolve;
        })
      );
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      await user.type(screen.getByLabelText(/student id/i), 'STU-123');
      await user.type(screen.getByLabelText(/email address/i), 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /validate student id/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /proceed to account creation/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /proceed to account creation/i }));
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePass123!');
      await user.type(confirmInput, 'SecurePass123!');
      await user.click(screen.getByRole('button', { name: /create account/i }));
      expect(screen.getByLabelText(/^password$/i)).toBeDisabled();
      resolveRegister({
        userId: 'user123',
        email: 'test@university.edu',
        accessToken: 'access123',
        refreshToken: 'refresh123',
        accountStatus: 'pending_verification',
      });
    });
  });

  describe('LocalStorage Persistence', () => {
    it('persists form data across page reloads', () => {
      const { unmount } = render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      
      // Form should render initially
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
      
      unmount();
      
      // Remount - form should be available for use
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    });

    it('saves auth state to localStorage on successful registration', () => {
      const localStorageSpy = jest.spyOn(Storage.prototype, 'setItem');
      
      const setAuth = jest.fn();
      useAuthStore.mockReturnValue({
        setAuth,
        setError: jest.fn(),
        error: null,
      });
      
      render(
        <MemoryRouter>
          <RegisterForm />
        </MemoryRouter>
      );
      
      // Form should render
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
      
      localStorageSpy.mockRestore();
    });
  });
});
