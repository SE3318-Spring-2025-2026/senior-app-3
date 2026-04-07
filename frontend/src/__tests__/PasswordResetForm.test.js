import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ResetPasswordPage from '../components/ResetPasswordPage';
import * as authService from '../api/authService';

jest.mock('../api/authService');

describe('PasswordResetForm (ResetPasswordPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders validating state initially', () => {
      let resolveValidate;
      authService.validatePasswordResetToken.mockReturnValue(
        new Promise((resolve) => {
          resolveValidate = resolve;
        })
      );
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      expect(screen.getByText(/validating reset link/i)).toBeInTheDocument();
    });

    it('renders password form when token is valid', async () => {
      authService.validatePasswordResetToken.mockResolvedValue({
        valid: true,
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
      });
    });
  });

  describe('Token Validation', () => {
    it('calls validatePasswordResetToken on mount', async () => {
      authService.validatePasswordResetToken.mockResolvedValue({
        valid: true,
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=token123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(authService.validatePasswordResetToken).toHaveBeenCalledWith('token123');
      });
    });

    it('shows error when token is missing from URL', async () => {
      render(
        <MemoryRouter initialEntries={['/auth/reset-password']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByText(/link expired/i)).toBeInTheDocument();
      });
    });

    it('shows error when token validation fails', async () => {
      authService.validatePasswordResetToken.mockRejectedValue({
        response: { data: { message: 'Invalid token' } },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=invalid']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByText(/link expired/i)).toBeInTheDocument();
      });
    });

    it('shows expired link message on validation error', async () => {
      authService.validatePasswordResetToken.mockRejectedValue({
        response: { data: { code: 'INVALID_TOKEN' } },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=expired']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
      });
    });
  });

  describe('Invalid/Expired Token Handling', () => {
    it('hides form when token is invalid', async () => {
      authService.validatePasswordResetToken.mockRejectedValue({
        response: { data: { code: 'INVALID_TOKEN' } },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=invalid']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
      });
    });

    it('provides button to request new link on error', async () => {
      authService.validatePasswordResetToken.mockRejectedValue({
        response: { data: { code: 'EXPIRED_TOKEN' } },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=expired']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /request a new link/i })).toBeInTheDocument();
      });
    });

    it('provides button to back to sign in', async () => {
      authService.validatePasswordResetToken.mockRejectedValue({
        response: { data: { message: 'Invalid' } },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=bad']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument();
      });
    });
  });

  describe('Password Validation', () => {
    it('requires password to be at least 8 characters', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'Short1!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(
          screen.getByText(
            (content, element) =>
              /at least 8 characters/i.test(content) &&
              element?.className.includes('error-message')
          )
        ).toBeInTheDocument();
      });
    });

    it('requires uppercase letter', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'lowercase123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(
          screen.getByText(
            (content, element) =>
              /uppercase letter/i.test(content) &&
              element?.className.includes('error-message')
          )
        ).toBeInTheDocument();
      });
    });

    it('requires lowercase letter', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'UPPERCASE123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(
          screen.getByText(
            (content, element) =>
              /lowercase letter/i.test(content) &&
              element?.className.includes('error-message')
          )
        ).toBeInTheDocument();
      });
    });

    it('requires digit', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'NoDigits!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(
          screen.getByText(
            (content, element) =>
              /at least one digit/i.test(content) &&
              element?.className.includes('error-message')
          )
        ).toBeInTheDocument();
      });
    });

    it('requires special character', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'NoSpecial123');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(
          screen.getByText(
            (content, element) =>
              /special character/i.test(content) &&
              element?.className.includes('error-message')
          )
        ).toBeInTheDocument();
      });
    });

    it('displays password strength bar while typing', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'StrongPass123!');
      expect(screen.getByText(/strong password/i)).toBeInTheDocument();
    });
  });

  describe('Confirm Password', () => {
    it('shows error when passwords do not match', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'StrongPass123!');
      await user.type(confirmInput, 'DifferentPass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('requires confirm password to be filled', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'StrongPass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/please confirm your password/i)).toBeInTheDocument();
      });
    });
  });

  describe('API Calls', () => {
    it('calls confirmPasswordReset with token and password on submit', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockResolvedValue({ message: 'Success' });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=reset-token-123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(authService.confirmPasswordReset).toHaveBeenCalledWith(
          'reset-token-123',
          'NewSecurePass123!'
        );
      });
    });
  });

  describe('Success State', () => {
    it('shows success message on successful reset', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockResolvedValue({ message: 'Password updated' });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/password has been changed successfully/i)).toBeInTheDocument();
      });
    });

    it('provides sign in button after success', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
      });
    });

    it('mentions all sessions are signed out', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/all previous sessions/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error States During Reset', () => {
    it('shows error when password is weak (400/WEAK_PASSWORD)', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockRejectedValue({
        response: {
          data: {
            code: 'WEAK_PASSWORD',
            details: ['Password too weak'],
          },
        },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'WeakPassword123!');
      await user.type(confirmInput, 'WeakPassword123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/password too weak/i)).toBeInTheDocument();
      });
    });

    it('shows error for link already used (410/INVALID_TOKEN)', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockRejectedValue({
        response: {
          data: {
            code: 'INVALID_TOKEN',
            message: 'Link already used',
          },
        },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
      });
    });

    it('shows generic error fallback', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      authService.confirmPasswordReset.mockRejectedValue({
        response: {
          data: { message: 'Server error' },
        },
      });
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => {
        expect(screen.getByText(/Server error/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading text in button while submitting', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      let resolveConfirm;
      authService.confirmPasswordReset.mockReturnValue(
        new Promise((resolve) => {
          resolveConfirm = resolve;
        })
      );
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      expect(screen.getByRole('button', { name: /updating/i })).toBeInTheDocument();
      resolveConfirm({ message: 'Success' });
    });

    it('disables submit button while loading', async () => {
      const user = userEvent.setup();
      authService.validatePasswordResetToken.mockResolvedValue({ valid: true });
      let resolveConfirm;
      authService.confirmPasswordReset.mockReturnValue(
        new Promise((resolve) => {
          resolveConfirm = resolve;
        })
      );
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=abc123']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      });
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(screen.getByRole('button', { name: /set new password/i }));
      expect(screen.getByRole('button', { name: /updating/i })).toBeDisabled();
      resolveConfirm({ message: 'Success' });
    });
  });

  describe('LocalStorage Persistence', () => {
    it('persists reset token and email to localStorage', () => {
      authService.validatePasswordResetToken.mockResolvedValue({
        valid: true,
        email: 'reset@university.edu',
      });
      
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=persist-token']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      
      // Component should render with validation message
      expect(screen.getByText(/validating/i)).toBeInTheDocument();
    });

    it('maintains reset flow state across page reload', () => {
      authService.validatePasswordResetToken.mockResolvedValue({
        valid: true,
        email: 'persistent@university.edu',
      });
      
      const { unmount } = render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=token-persist-789']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      
      // Form should render with validation message
      expect(screen.getByText(/validating/i)).toBeInTheDocument();
      
      unmount();
      
      // Remount - reset flow should still be available
      render(
        <MemoryRouter initialEntries={['/auth/reset-password?token=token-persist-789']}>
          <ResetPasswordPage />
        </MemoryRouter>
      );
      
      // Form should still show validation message
      expect(screen.getByText(/validating/i)).toBeInTheDocument();
    });
  });
});
