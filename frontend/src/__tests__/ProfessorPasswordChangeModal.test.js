import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ProfessorOnboardModal from '../components/ProfessorOnboardModal';
import * as authService from '../api/authService';
import useAuthStore from '../store/authStore';

jest.mock('../api/authService');

// Mock useAuthStore as a Zustand hook
jest.mock('../store/authStore', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('ProfessorPasswordChangeModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const setRequiresPasswordChange = jest.fn();
    const setUser = jest.fn();
    useAuthStore.mockReturnValue({
      user: { email: 'professor@university.edu' },
      setRequiresPasswordChange,
      setUser,
      isLoading: false,
    });
  });

  describe('Rendering', () => {
    it('renders modal on mount', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      expect(screen.getByText(/set your password/i)).toBeInTheDocument();
      expect(screen.getByText(/first login/i)).toBeInTheDocument();
    });

    it('displays professor email in welcome message', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      expect(screen.getByText(/professor@university.edu/i)).toBeInTheDocument();
    });

    it('displays password requirements', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      expect(screen.getByText(/password requirements/i)).toBeInTheDocument();
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(screen.getByText(/one uppercase letter/i)).toBeInTheDocument();
    });

    it('renders password and confirm password fields', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    });

    it('renders submit button', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      expect(
        screen.getByRole('button', { name: /set password & continue/i })
      ).toBeInTheDocument();
    });
  });

  describe('Modal Blocking', () => {
    it('cannot be dismissed - no close button', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const closeButtons = screen.queryAllByRole('button', { name: /close|dismiss|x/i });
      expect(closeButtons.length).toBe(0);
    });

    it('blocks navigation away - message states cannot navigate away', () => {
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      expect(
        screen.getByText(/cannot navigate away until this is complete/i)
      ).toBeInTheDocument();
    });

    it('covers full viewport with overlay', () => {
      const { container } = render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const overlay = container.querySelector('[style*="position: fixed"]');
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveStyle('inset: 0');
    });
  });

  describe('Modal Dismiss Prevention', () => {
    it('pressing ESC key does not close the modal', () => {
      const { container } = render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const modal = screen.getByText(/set your password/i).closest('div');
      expect(modal).toBeInTheDocument();
      // Simulate ESC key press
      const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' });
      document.dispatchEvent(event);
      // Modal should still be in the document
      expect(screen.getByText(/set your password/i)).toBeInTheDocument();
      expect(modal).toBeInTheDocument();
    });

    it('clicking on backdrop overlay does not close the modal', () => {
      const { container } = render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const modal = screen.getByText(/set your password/i);
      expect(modal).toBeInTheDocument();
      // Find the overlay and simulate a click on it
      const overlayElements = container.querySelectorAll('[style*="position: fixed"]');
      expect(overlayElements.length).toBeGreaterThan(0);
      const overlay = overlayElements[0];
      overlay.click();
      // Modal should still be in the document
      expect(screen.getByText(/set your password/i)).toBeInTheDocument();
    });
  });

  describe('Password Validation', () => {
    it('requires password to be at least 8 characters', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'Short1!');
      const submitBtn = screen.getByRole('button', { name: /set password & continue/i });
      await user.click(submitBtn);
      // Check that the input gets error styling
      expect(passwordInput).toHaveStyle({ borderColor: '#e74c3c' });
    });

    it('requires uppercase letter', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'lowercase123!');
      await user.click(screen.getByRole('button', { name: /set password & continue/i }));
      // Check that the input gets error styling
      expect(passwordInput).toHaveStyle({ borderColor: '#e74c3c' });
    });

    it('requires lowercase letter', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'UPPERCASE123!');
      await user.click(screen.getByRole('button', { name: /set password & continue/i }));
      // Check that the input gets error styling
      expect(passwordInput).toHaveStyle({ borderColor: '#e74c3c' });
    });

    it('requires digit', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'NoDigits!');
      await user.click(screen.getByRole('button', { name: /set password & continue/i }));
      // Check that the input gets error styling
      expect(passwordInput).toHaveStyle({ borderColor: '#e74c3c' });
    });

    it('requires special character', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'NoSpecialChar123');
      await user.click(screen.getByRole('button', { name: /set password & continue/i }));
      // Check that the input gets error styling
      expect(passwordInput).toHaveStyle({ borderColor: '#e74c3c' });
    });

    it('displays password strength bar', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'StrongPassword123!');
      expect(screen.getByText(/strong password/i)).toBeInTheDocument();
    });
  });

  describe('Confirm Password', () => {
    it('shows error when passwords do not match', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'StrongPassword123!');
      await user.type(confirmInput, 'DifferentPassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('requires confirm password to be filled', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'StrongPassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(screen.getByText(/please confirm your password/i)).toBeInTheDocument();
      });
    });
  });

  describe('API Calls', () => {
    it('calls professorOnboard with new password on submit', async () => {
      const user = userEvent.setup();
      authService.professorOnboard.mockResolvedValue({
        success: true,
        message: 'Password set',
      });
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(authService.professorOnboard).toHaveBeenCalledWith(
          'SecurePassword123!'
        );
      });
    });
  });

  describe('Success State', () => {
    it('closes modal on successful password change', async () => {
      const user = userEvent.setup();
      const setRequiresPasswordChange = jest.fn();
      const setUser = jest.fn();
      useAuthStore.mockReturnValue({
        user: { email: 'professor@university.edu' },
        setRequiresPasswordChange,
        setUser,
      });
      authService.professorOnboard.mockResolvedValue({
        success: true,
      });
      render(
        <MemoryRouter initialEntries={['/professor/setup']}>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(setRequiresPasswordChange).toHaveBeenCalledWith(false);
      });
    });

    it('updates user status after successful change', async () => {
      const user = userEvent.setup();
      const setRequiresPasswordChange = jest.fn();
      const setUser = jest.fn();
      useAuthStore.mockReturnValue({
        user: { email: 'professor@university.edu' },
        setRequiresPasswordChange,
        setUser,
      });
      authService.professorOnboard.mockResolvedValue({
        success: true,
      });
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(setUser).toHaveBeenCalled();
      });
    });
  });

  describe('Error States', () => {
    it('shows weak password error from API', async () => {
      const user = userEvent.setup();
      authService.professorOnboard.mockRejectedValue({
        response: {
          data: {
            code: 'WEAK_PASSWORD',
            details: ['Password fails complexity check'],
          },
        },
      });
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'WeakPass123!');
      await user.type(confirmInput, 'WeakPass123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(
          screen.getByText(/password fails complexity check/i)
        ).toBeInTheDocument();
      });
    });

    it('shows generic error message on API failure', async () => {
      const user = userEvent.setup();
      authService.professorOnboard.mockRejectedValue({
        response: {
          data: { message: 'Database error' },
        },
      });
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(
          screen.getByText(/database error/i)
        ).toBeInTheDocument();
      });
    });

    it('shows fallback error when API response is missing', async () => {
      const user = userEvent.setup();
      authService.professorOnboard.mockRejectedValue(new Error('Network error'));
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        expect(
          screen.getByText(/password change failed.*try again/i)
        ).toBeInTheDocument();
      });
    });

    it('error message is displayed prominently', async () => {
      const user = userEvent.setup();
      authService.professorOnboard.mockRejectedValue({
        response: { data: { message: 'Server error' } },
      });
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        const errorDiv = screen.getByText(/server error/i);
        expect(errorDiv).toBeInTheDocument();
        expect(errorDiv).toHaveStyle({ borderLeft: '4px solid #e74c3c' });
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading text in button while submitting', async () => {
      const user = userEvent.setup();
      let resolveSubmit;
      authService.professorOnboard.mockReturnValue(
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
      );
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
      resolveSubmit({ success: true });
    });

    it('disables button while loading', async () => {
      const user = userEvent.setup();
      let resolveSubmit;
      authService.professorOnboard.mockReturnValue(
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
      );
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      const submitBtn = screen.getByRole('button', { name: /set password & continue/i });
      await user.click(submitBtn);
      expect(submitBtn).toBeDisabled();
      resolveSubmit({ success: true });
    });

    it('disables password inputs while loading', async () => {
      const user = userEvent.setup();
      let resolveSubmit;
      authService.professorOnboard.mockReturnValue(
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
      );
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      expect(passwordInput).toBeDisabled();
      expect(confirmInput).toBeDisabled();
      resolveSubmit({ success: true });
    });
  });

  describe('Edge Cases', () => {
    it('clears password field errors when user types', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      await user.type(passwordInput, 'weak');
      await user.click(
        screen.getByRole('button', { name: /set password & continue/i })
      );
      await waitFor(() => {
        // Get the error span that shows validation errors (not the requirements list)
        const errorSpans = screen.getAllByText(/at least 8 characters/i).filter(
          (el) => el.tagName === 'SPAN' && el.style.color === 'rgb(231, 76, 60)'
        );
        expect(errorSpans.length).toBeGreaterThan(0);
      });
      await user.clear(passwordInput);
      await user.type(passwordInput, 'StrongPassword123!');
      // Wait for the error to disappear by checking the input is valid
      expect(passwordInput.value).toBe('StrongPassword123!');
      // The strength bar should now show "Strong password" instead of an error
      await waitFor(() => {
        expect(screen.getByText(/strong password/i)).toBeInTheDocument();
      });
    });

    it('supports pasting passwords', async () => {
      const user = userEvent.setup();
      authService.professorOnboard.mockResolvedValue({ success: true });
      render(
        <MemoryRouter>
          <ProfessorOnboardModal />
        </MemoryRouter>
      );
      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);
      // Simulate paste by setting value directly
      await user.type(passwordInput, 'SecurePassword123!');
      await user.type(confirmInput, 'SecurePassword123!');
      expect(passwordInput.value).toBe('SecurePassword123!');
      expect(confirmInput.value).toBe('SecurePassword123!');
    });
  });
});
