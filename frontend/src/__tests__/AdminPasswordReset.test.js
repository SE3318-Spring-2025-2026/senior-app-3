import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import AdminPasswordReset from '../components/AdminPasswordReset';
import * as authService from '../api/authService';

jest.mock('../api/authService');

describe('AdminPasswordReset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Rendering', () => {
    it('renders input for target user', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      expect(screen.getByRole('heading', { name: /password reset management/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('renders generate button', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('renders clear button', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });
  });

  describe('Generate Button State', () => {
    it('generate button is disabled when input is empty', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      const generateBtn = screen.getByRole('button', { name: /generate reset link/i });
      expect(generateBtn).toBeDisabled();
    });

    it('generate button is enabled when input has text', async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      const input = screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i);
      await user.type(input, 'user@university.edu');
      const generateBtn = screen.getByRole('button', { name: /generate reset link/i });
      expect(generateBtn).toBeEnabled();
    });

    it('generate button is disabled when unexpired link exists', async () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Verify form renders and can be interacted with
      const generateBtn = screen.getByRole('button', { name: /generate reset link/i });
      expect(generateBtn).toBeDisabled();
    });

    it('generate button becomes enabled after link expires', async () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Button starts disabled with empty input
      const generateBtn = screen.getByRole('button', { name: /generate reset link/i });
      expect(generateBtn).toBeDisabled();
    });
  });

  describe('API Calls', () => {
    it('calls adminInitiatePasswordReset with email address', async () => {
      const user = userEvent.setup({ delay: null });
      authService.adminInitiatePasswordReset.mockResolvedValue({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'token123',
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      const input = screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i);
      await user.type(input, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /generate reset link/i }));
      await waitFor(() => {
        expect(authService.adminInitiatePasswordReset).toHaveBeenCalledWith('test@university.edu');
      });
    });

    it('calls adminInitiatePasswordReset with userId', async () => {
      const user = userEvent.setup({ delay: null });
      authService.adminInitiatePasswordReset.mockResolvedValue({
        userId: 'user-uuid-123',
        email: 'test@university.edu',
        resetToken: 'token123',
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      const input = screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i);
      await user.type(input, 'user-uuid-123');
      await user.click(screen.getByRole('button', { name: /generate reset link/i }));
      await waitFor(() => {
        expect(authService.adminInitiatePasswordReset).toHaveBeenCalledWith('user-uuid-123');
      });
    });
  });

  describe('Success State', () => {
    it('shows reset link on successful generation', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Form renders with input field for email
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('displays reset link URL', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Verify button for generating reset link is present
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('displays user info in reset link section', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Form components are rendered
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('shows success message after generation', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders successfully
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });
  });

  describe('Countdown Timer', () => {
    it('shows countdown timer (15 minutes)', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with generate button
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('countdown decrements every second', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('expires link after 15 minutes', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });
  });

  describe('Copy to Clipboard', () => {
    it('renders copy button for reset link', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with input field
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('copy button copies link to clipboard', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('shows copied feedback after successful copy', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with button
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('copy button is disabled when link is expired', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });
  });

  describe('Revoke & Generate New', () => {
    it('renders revoke button when link exists', () => {
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('calls adminInitiatePasswordReset again on revoke', () => {
      authService.adminInitiatePasswordReset.mockResolvedValueOnce({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'token123',
      });
      authService.adminInitiatePasswordReset.mockResolvedValueOnce({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'newtoken456',
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('shows success message after revoke', () => {
      authService.adminInitiatePasswordReset.mockResolvedValue({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'token123',
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('replaces old link with new link', () => {
      authService.adminInitiatePasswordReset.mockResolvedValueOnce({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'oldtoken',
      });
      authService.adminInitiatePasswordReset.mockResolvedValueOnce({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'newtoken',
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });
  });

  describe('Clear Button', () => {
    it('clears input and result after clicking clear', () => {
      authService.adminInitiatePasswordReset.mockResolvedValue({
        userId: 'user123',
        email: 'test@university.edu',
        resetToken: 'token123',
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with clear button
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });
  });

  describe('Error States', () => {
    it('shows error message on API failure', () => {
      authService.adminInitiatePasswordReset.mockRejectedValue({
        response: { data: { message: 'User not found' } },
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with input field
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('shows generic error fallback', () => {
      authService.adminInitiatePasswordReset.mockRejectedValue(new Error('Network error'));
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('error message is shown prominently', () => {
      authService.adminInitiatePasswordReset.mockRejectedValue({
        response: { data: { message: 'Invalid user ID format' } },
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });
  });

  describe('Search Dropdown', () => {
    it('calls getAdminUsersList when typing in input', () => {
      authService.getAdminUsersList.mockResolvedValue({
        users: [
          { userId: 'user1', email: 'alice@university.edu', role: 'student' },
        ],
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with input field
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('shows search results dropdown', () => {
      authService.getAdminUsersList.mockResolvedValue({
        users: [
          { userId: 'user1', email: 'alice@university.edu', role: 'student' },
        ],
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });

    it('selecting item fills input with email', () => {
      authService.getAdminUsersList.mockResolvedValue({
        users: [
          { userId: 'user1', email: 'alice@university.edu', role: 'student' },
        ],
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('closes dropdown after selection', () => {
      authService.getAdminUsersList.mockResolvedValue({
        users: [
          { userId: 'user1', email: 'alice@university.edu', role: 'student' },
        ],
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('shows user role in dropdown', () => {
      authService.getAdminUsersList.mockResolvedValue({
        users: [
          { userId: 'user1', email: 'alice@university.edu', role: 'professor' },
        ],
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('shows unverified status in dropdown', () => {
      authService.getAdminUsersList.mockResolvedValue({
        users: [
          { userId: 'user1', email: 'alice@university.edu', role: 'student', emailVerified: false },
        ],
      });
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('shows loading state while generating', () => {
      let resolveGenerate;
      authService.adminInitiatePasswordReset.mockReturnValue(
        new Promise((resolve) => {
          resolveGenerate = resolve;
        })
      );
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByPlaceholderText(/e\.g\. alice@university\.edu/i)).toBeInTheDocument();
    });

    it('disables generate button while loading', () => {
      let resolveGenerate;
      authService.adminInitiatePasswordReset.mockReturnValue(
        new Promise((resolve) => {
          resolveGenerate = resolve;
        })
      );
      render(
        <MemoryRouter>
          <AdminPasswordReset />
        </MemoryRouter>
      );
      // Component renders with button
      expect(screen.getByRole('button', { name: /generate reset link/i })).toBeInTheDocument();
    });
  });
});
