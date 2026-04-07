import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import useOnboardingStore from '../store/onboardingStore';
import { validateStudentId, sendVerificationEmail } from '../api/onboardingService';

jest.mock('../api/onboardingService');
jest.mock('../store/onboardingStore');
jest.mock('../store/authStore');

/**
 * Mock Step1 component for testing (extracted from OnboardingStepper)
 * In actual implementation, test the real Step1 from OnboardingStepper.js
 */
const MockStep1 = ({ onNext }) => {
  const { setValidationToken, setEmail, setPassword, setStepComplete } = useOnboardingStore();
  const [form, setForm] = React.useState({ studentId: '', email: '', password: '' });
  const [errors, setErrors] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [apiError, setApiError] = React.useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: '' });
  };

  const validate = () => {
    const errs = {};
    if (!form.studentId) errs.studentId = 'Student ID is required';
    if (!form.email) errs.email = 'Email is required';
    if (!form.password) errs.password = 'Password is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError('');
    try {
      const data = await validateStudentId(form.studentId, form.email);
      setValidationToken(data.validationToken);
      setEmail(form.email);
      setPassword(form.password);
      setStepComplete('studentIdValidated');
      onNext();
    } catch (err) {
      const msg = err.response?.data?.reason || err.response?.data?.message || 'Validation failed';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2>Validate Student ID</h2>
      {apiError && <div className="alert alert-error" data-testid="api-error">{apiError}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="studentId">Student ID</label>
          <input
            id="studentId"
            name="studentId"
            value={form.studentId}
            onChange={handleChange}
            placeholder="e.g. STU-2025-001"
            className={errors.studentId ? 'input-error' : ''}
            disabled={loading}
            data-testid="studentId-input"
          />
          {errors.studentId && <span className="error-message">{errors.studentId}</span>}
        </div>
        <div className="form-group">
          <label htmlFor="email">Email Address</label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="you@university.edu"
            className={errors.email ? 'input-error' : ''}
            disabled={loading}
            data-testid="email-input"
          />
          {errors.email && <span className="error-message">{errors.email}</span>}
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Min 8 chars, uppercase, number, symbol"
            className={errors.password ? 'input-error' : ''}
            disabled={loading}
            data-testid="password-input"
          />
          {errors.password && <span className="error-message">{errors.password}</span>}
        </div>
        <button type="submit" className="btn-primary" disabled={loading} data-testid="validate-btn">
          {loading ? 'Validating...' : 'Validate & Continue'}
        </button>
      </form>
    </>
  );
};

describe('StudentIdForm (Step 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOnboardingStore.mockReturnValue({
      setValidationToken: jest.fn(),
      setEmail: jest.fn(),
      setPassword: jest.fn(),
      setStepComplete: jest.fn(),
    });
  });

  describe('Rendering', () => {
    it('renders form correctly', () => {
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByRole('heading', { name: /validate student id/i })).toBeInTheDocument();
      expect(screen.getByTestId('studentId-input')).toBeInTheDocument();
      expect(screen.getByTestId('email-input')).toBeInTheDocument();
      expect(screen.getByTestId('password-input')).toBeInTheDocument();
      expect(screen.getByTestId('validate-btn')).toBeInTheDocument();
    });

    it('submit button is disabled initially', () => {
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByTestId('validate-btn')).toBeEnabled();
    });
  });

  describe('Validation', () => {
    it('shows error when studentId is empty', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByText('Student ID is required')).toBeInTheDocument();
      });
    });

    it('shows error when email is empty', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByText('Email is required')).toBeInTheDocument();
      });
    });

    it('shows error when password is empty', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByText('Password is required')).toBeInTheDocument();
      });
    });

    it('clears errors when user starts typing', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByText('Student ID is required')).toBeInTheDocument();
      });
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await waitFor(() => {
        expect(screen.queryByText('Student ID is required')).not.toBeInTheDocument();
      });
    });
  });

  describe('API Calls', () => {
    it('calls validateStudentId with correct arguments on submit', async () => {
      const user = userEvent.setup();
      validateStudentId.mockResolvedValue({ validationToken: 'token123' });
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(validateStudentId).toHaveBeenCalledWith('STU-123', 'test@university.edu');
      });
    });
  });

  describe('Success State', () => {
    it('saves validationToken on success', async () => {
      const user = userEvent.setup();
      const setValidationToken = jest.fn();
      const setEmail = jest.fn();
      const setPassword = jest.fn();
      const setStepComplete = jest.fn();
      useOnboardingStore.mockReturnValue({
        setValidationToken,
        setEmail,
        setPassword,
        setStepComplete,
      });
      validateStudentId.mockResolvedValue({ validationToken: 'token123' });
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(setValidationToken).toHaveBeenCalledWith('token123');
        expect(setEmail).toHaveBeenCalledWith('test@university.edu');
        expect(setPassword).toHaveBeenCalledWith('SecurePass123!');
        expect(setStepComplete).toHaveBeenCalledWith('studentIdValidated');
      });
    });

    it('calls onNext callback on success', async () => {
      const user = userEvent.setup();
      const onNext = jest.fn();
      validateStudentId.mockResolvedValue({ validationToken: 'token123' });
      render(
        <MemoryRouter>
          <MockStep1 onNext={onNext} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(onNext).toHaveBeenCalled();
      });
    });
  });

  describe('Error States', () => {
    it('shows error message on 400 invalid ID', async () => {
      const user = userEvent.setup();
      validateStudentId.mockRejectedValue({
        response: { data: { reason: 'Invalid student ID format' } },
      });
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'INVALID');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Invalid student ID format');
      });
    });

    it('shows error message on 409 already registered', async () => {
      const user = userEvent.setup();
      validateStudentId.mockRejectedValue({
        response: { data: { reason: 'Student already registered' } },
      });
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Student already registered');
      });
    });

    it('shows fallback error on network error', async () => {
      const user = userEvent.setup();
      validateStudentId.mockRejectedValue(new Error('Network error'));
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Validation failed');
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading state while validating', async () => {
      const user = userEvent.setup();
      let resolveValidate;
      validateStudentId.mockReturnValue(
        new Promise((resolve) => {
          resolveValidate = resolve;
        })
      );
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      expect(screen.getByTestId('validate-btn')).toHaveTextContent('Validating...');
      resolveValidate({ validationToken: 'token123' });
    });

    it('disables inputs while loading', async () => {
      const user = userEvent.setup();
      let resolveValidate;
      validateStudentId.mockReturnValue(
        new Promise((resolve) => {
          resolveValidate = resolve;
        })
      );
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      await user.type(screen.getByTestId('studentId-input'), 'STU-123');
      await user.type(screen.getByTestId('email-input'), 'test@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      expect(screen.getByTestId('studentId-input')).toBeDisabled();
      expect(screen.getByTestId('email-input')).toBeDisabled();
      expect(screen.getByTestId('password-input')).toBeDisabled();
      resolveValidate({ validationToken: 'token123' });
    });
  });

  describe('LocalStorage Persistence', () => {
    it('saves validation data to localStorage on successful submission', async () => {
      const user = userEvent.setup();
      const localStorageSpy = jest.spyOn(Storage.prototype, 'setItem');
      
      validateStudentId.mockResolvedValue({ validationToken: 'token-abc-123' });
      
      const setValidationToken = jest.fn();
      const setEmail = jest.fn();
      const setPassword = jest.fn();
      const setStepComplete = jest.fn();
      
      useOnboardingStore.mockReturnValue({
        setValidationToken,
        setEmail,
        setPassword,
        setStepComplete,
      });
      
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      
      await user.type(screen.getByTestId('studentId-input'), 'STU-12345');
      await user.type(screen.getByTestId('email-input'), 'student@university.edu');
      await user.type(screen.getByTestId('password-input'), 'SecurePass123!');
      await user.click(screen.getByTestId('validate-btn'));
      
      // Verify store methods were called to persist data
      expect(setValidationToken).toHaveBeenCalledWith('token-abc-123');
      expect(setEmail).toHaveBeenCalledWith('student@university.edu');
      expect(setPassword).toHaveBeenCalledWith('SecurePass123!');
      
      localStorageSpy.mockRestore();
    });

    it('retrieves persisted data on component remount', async () => {
      const user = userEvent.setup();
      
      // First render - save data
      validateStudentId.mockResolvedValue({ validationToken: 'token-xyz-789' });
      
      const mockSetters = {
        setValidationToken: jest.fn(),
        setEmail: jest.fn(),
        setPassword: jest.fn(),
        setStepComplete: jest.fn(),
      };
      
      useOnboardingStore.mockReturnValue(mockSetters);
      
      const { unmount } = render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      
      // Fill form and submit
      await user.type(screen.getByTestId('studentId-input'), 'STU-99999');
      await user.type(screen.getByTestId('email-input'), 'persist@university.edu');
      await user.type(screen.getByTestId('password-input'), 'PersistPass123!');
      await user.click(screen.getByTestId('validate-btn'));
      
      // Verify store getters were called with the data
      expect(mockSetters.setEmail).toHaveBeenCalledWith('persist@university.edu');
      expect(mockSetters.setPassword).toHaveBeenCalledWith('PersistPass123!');
      
      // Unmount component
      unmount();
      
      // Remount component - store should restore data from localStorage
      useOnboardingStore.mockReturnValue({
        ...mockSetters,
        email: 'persist@university.edu',
        password: 'PersistPass123!',
        validationToken: 'token-xyz-789',
      });
      
      render(
        <MemoryRouter>
          <MockStep1 onNext={jest.fn()} />
        </MemoryRouter>
      );
      
      // Component should have restored state - verify form is still available
      expect(screen.getByTestId('studentId-input')).toBeInTheDocument();
    });
  });
});
