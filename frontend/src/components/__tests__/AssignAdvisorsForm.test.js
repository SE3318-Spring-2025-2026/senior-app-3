import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignAdvisorsForm from '../AssignAdvisorsForm';
import * as committeeService from '../../api/committeeService';

// Mock the committee service
jest.mock('../../api/committeeService');

describe('AssignAdvisorsForm Component', () => {
  const mockCommitteeId = 'cmte_test123';
  const mockOnSubmitSuccess = jest.fn();
  const mockOnError = jest.fn();

  const mockAdvisors = [
    { userId: 'usr_prof1', email: 'prof1@test.edu', name: 'Professor One', role: 'professor' },
    { userId: 'usr_prof2', email: 'prof2@test.edu', name: 'Professor Two', role: 'professor' },
    { userId: 'usr_prof3', email: 'prof3@test.edu', name: 'Professor Three', role: 'professor' },
  ];

  const mockCommittee = {
    committeeId: mockCommitteeId,
    committeeName: 'Test Committee',
    description: 'Test Description',
    advisorIds: [],
    juryIds: [],
    status: 'draft',
  };

  const mockUpdatedCommittee = {
    ...mockCommittee,
    advisorIds: ['usr_prof1', 'usr_prof2'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    committeeService.getAvailableAdvisors.mockResolvedValue(mockAdvisors);
    committeeService.getCommittee.mockResolvedValue(mockCommittee);
    committeeService.assignAdvisors.mockResolvedValue({
      success: true,
      committee: mockUpdatedCommittee,
      message: 'Successfully assigned 2 advisor(s)',
    });
  });

  // ✅ Test 1: Form renders multi-select list of advisors
  describe('✅ Successful Cases', () => {
    test('should render form with advisor list', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      // Wait for async data loading
      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      expect(screen.getByText('Assign Advisors to Committee')).toBeInTheDocument();
      expect(screen.getByText('Test Committee')).toBeInTheDocument();
      expect(screen.getByText('Professor One')).toBeInTheDocument();
      expect(screen.getByText('Professor Two')).toBeInTheDocument();
      expect(screen.getByText('Professor Three')).toBeInTheDocument();
    });

    test('should allow user to select multiple advisors', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]); // Select first advisor
      fireEvent.click(checkboxes[1]); // Select second advisor

      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).toBeChecked();
      expect(checkboxes[2]).not.toBeChecked();
      expect(screen.getByText('2 advisors selected')).toBeInTheDocument();
    });

    test('should submit form with selected advisors', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(committeeService.assignAdvisors).toHaveBeenCalledWith(mockCommitteeId, [
          'usr_prof1',
          'usr_prof2',
        ]);
      });
    });

    test('should show success message after successful submission', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Successfully assigned 2 advisor/i)).toBeInTheDocument();
      });
    });

    test('should call onSubmitSuccess callback after successful submission', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmitSuccess).toHaveBeenCalledWith(mockUpdatedCommittee);
      }, { timeout: 2000 });
    });
  });

  // ❌ Test 2: Validation errors
  describe('❌ Validation & Error Cases', () => {
    test('should prevent submission without selecting advisors', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const submitButton = screen.getByText('Assign Advisors');
      expect(submitButton).toBeDisabled();
    });

    test('should show error message without at least one advisor selected', async () => {
      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      // Verify submit button is disabled
      const submitButton = screen.getByText('Assign Advisors');
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveAttribute('disabled');
    });

    test('should handle 403 Forbidden error', async () => {
      const error = new Error('Coordinator role required');
      error.code = 403;
      error.details = { message: 'You do not have permission' };
      committeeService.assignAdvisors.mockRejectedValue(error);

      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/coordinator role required/i)).toBeInTheDocument();
      });
    });

    test('should handle 404 Committee Not Found error', async () => {
      const error = new Error('Committee not found');
      error.code = 404;
      error.details = { message: 'Committee not found' };
      committeeService.assignAdvisors.mockRejectedValue(error);

      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalled();
      });
    });

    test('should handle 409 Advisor Conflict error', async () => {
      const error = new Error('Advisor conflict');
      error.code = 409;
      error.details = {
        conflicts: [{ advisorId: 'usr_prof1', conflictingCommitteeId: 'cmte_other' }],
      };
      committeeService.assignAdvisors.mockRejectedValue(error);

      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Advisor conflict/i)).toBeInTheDocument();
      });
    });

    test('should handle 400 Bad Request error with validation details', async () => {
      const error = new Error('Invalid advisors');
      error.code = 400;
      error.details = {
        errors: [
          { advisorId: 'usr_invalid', reason: 'Advisor not found' },
        ],
      };
      committeeService.assignAdvisors.mockRejectedValue(error);

      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Invalid advisor/i)).toBeInTheDocument();
      });
    });
  });

  // ✅ Test 3: Component state and lifecycle
  describe('✅ Component Lifecycle', () => {
    test('should preselect already assigned advisors', async () => {
      const committeeWithAdvisors = {
        ...mockCommittee,
        advisorIds: ['usr_prof1'],
      };
      committeeService.getCommittee.mockResolvedValue(committeeWithAdvisors);

      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).not.toBeChecked();
    });

    test('should disable submit button during submission', async () => {
      committeeService.assignAdvisors.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
      );

      render(
        <AssignAdvisorsForm
          committeeId={mockCommitteeId}
          onSubmitSuccess={mockOnSubmitSuccess}
          onError={mockOnError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Professor One')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      const submitButton = screen.getByText('Assign Advisors');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });
  });
});
