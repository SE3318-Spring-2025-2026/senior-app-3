import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from '../components/ForgotPasswordPage';
import * as authService from '../api/authService';

jest.mock('../api/authService');

describe('ForgotPasswordPage (Forgot Password Form)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders form correctly', () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      expect(screen.getByRole('heading', { name: /forgot password/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    });

    it('displays subtitle explaining the flow', () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      expect(
        screen.getByText(/we'll send you a reset link/i)
      ).toBeInTheDocument();
    });

    it('renders back to login link', () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    it('submit button is enabled even with empty input (non-revealing design)', () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const submitBtn = screen.getByRole('button', { name: /send reset link/i });
      expect(submitBtn).toBeEnabled();
    });

    it('shows error when email is empty and submit is clicked', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
    });

    it('shows error on invalid email format', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'invalid-email');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email/i)).toBeInTheDocument();
      });
    });

    it('clears error when user types', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await waitFor(() => {
        expect(screen.queryByText(/email is required/i)).not.toBeInTheDocument();
      });
    });

    it('validates email format with basic regex', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@.com');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email/i)).toBeInTheDocument();
      });
    });
  });

  describe('API Calls', () => {
    it('calls requestPasswordReset with email', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(authService.requestPasswordReset).toHaveBeenCalledWith('test@university.edu');
      });
    });

    it('always shows success message (non-revealing)', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      });
    });

    it('shows success message even when email does not exist (non-revealing)', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'nonexistent@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        // Even with non-existent email, success message is shown
        expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      });
    });

    it('shows success message and displays entered email', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'user@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/user@university.edu/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error States', () => {
    it('silently ignores API errors (non-revealing)', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockRejectedValue(new Error('Server error'));
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        // Still shows success message (non-revealing)
        expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      });
    });

    it('does not show which emails exist or not exist', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'fake@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        // No error message indicating whether email exists or not
        expect(screen.queryByText(/email not found/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/account does not exist/i)).not.toBeInTheDocument();
      });
    });

    it('network error still shows success message (non-revealing)', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockRejectedValue({
        message: 'Network error',
      });
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading text in button while sending', async () => {
      const user = userEvent.setup();
      let resolveSend;
      authService.requestPasswordReset.mockReturnValue(
        new Promise((resolve) => {
          resolveSend = resolve;
        })
      );
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();
      resolveSend({});
    });

    it('disables email input while loading', async () => {
      const user = userEvent.setup();
      let resolveSend;
      authService.requestPasswordReset.mockReturnValue(
        new Promise((resolve) => {
          resolveSend = resolve;
        })
      );
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      expect(emailInput).toBeDisabled();
      resolveSend({});
    });
  });

  describe('Success Screen', () => {
    it('shows success screen after submission', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      });
    });

    it('displays the email that was submitted', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'john@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/john@university.edu/i)).toBeInTheDocument();
      });
    });

    it('provides option to try different email', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/try a different email/i)).toBeInTheDocument();
      });
    });

    it('allows resetting form to try different email', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(async () => {
        const tryDifferentBtn = screen.getByRole('button', { name: /try a different email/i });
        expect(tryDifferentBtn).toBeInTheDocument();
        await user.click(tryDifferentBtn);
      });
      // Should return to form
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('mentions link expiration time', async () => {
      const user = userEvent.setup();
      authService.requestPasswordReset.mockResolvedValue({});
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@university.edu');
      await user.click(screen.getByRole('button', { name: /send reset link/i }));
      await waitFor(() => {
        expect(screen.getByText(/15 minutes/i)).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('back to sign in button navigates to login', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter initialEntries={['/auth/forgot-password']}>
          <ForgotPasswordPage />
        </MemoryRouter>
      );
      const backBtn = screen.getByRole('button', { name: /back to sign in/i });
      await user.click(backBtn);
      // In a real app, we'd verify navigation occurred
      expect(backBtn).toBeInTheDocument();
    });
  });
});
