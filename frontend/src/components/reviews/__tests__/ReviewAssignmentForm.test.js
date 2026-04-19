import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ReviewAssignmentForm from '../ReviewAssignmentForm';
import reviewService from '../../../api/reviewService';

jest.mock('../../../api/reviewService');

describe('ReviewAssignmentForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Form Rendering', () => {
    test('renders the form with title', () => {
      render(<ReviewAssignmentForm deliverableId="d1" />);
      expect(screen.getByRole('heading', { name: /Assign Review/i })).toBeInTheDocument();
    });

    test('renders review deadline input field', () => {
      render(<ReviewAssignmentForm deliverableId="d1" />);
      expect(screen.getByLabelText(/Review Deadline/i)).toBeInTheDocument();
    });

    test('renders committee member selection checkboxes', () => {
      render(<ReviewAssignmentForm deliverableId="d1" />);
      expect(screen.getByTestId('committee-member-member-1')).toBeInTheDocument();
      expect(screen.getByTestId('committee-member-member-2')).toBeInTheDocument();
      expect(screen.getByTestId('committee-member-member-3')).toBeInTheDocument();
    });

    test('renders instructions textarea', () => {
      render(<ReviewAssignmentForm deliverableId="d1" />);
      expect(screen.getByLabelText(/Instructions/i)).toBeInTheDocument();
    });

    test('renders submit button', () => {
      render(<ReviewAssignmentForm deliverableId="d1" />);
      expect(screen.getByTestId('submit-button')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Assign Review/i })).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    test('reviewDeadlineDays is required - cannot submit with empty deadline', async () => {
      const user = userEvent.setup();
      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Leave deadline empty and try to submit
      const submitBtn = screen.getByTestId('submit-button');
      await user.click(submitBtn);

      // Should see error message
      await waitFor(() => {
        expect(screen.getByText(/Review deadline is required/i)).toBeInTheDocument();
      });

      // Service should not be called
      expect(reviewService.assignReview).not.toHaveBeenCalled();
    });

    test('selectedCommitteeMembers must have at least one selection', async () => {
      const user = userEvent.setup();
      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill deadline
      const deadlineInput = screen.getByTestId('deadline-input');
      await user.type(deadlineInput, '7');

      // Try to submit without selecting committee members
      const submitBtn = screen.getByTestId('submit-button');
      await user.click(submitBtn);

      // Should see error message
      await waitFor(() => {
        expect(screen.getByText(/At least one committee member must be selected/i)).toBeInTheDocument();
      });

      expect(reviewService.assignReview).not.toHaveBeenCalled();
    });
  });

  describe('Multi-Select Functionality', () => {
    test('selecting and deselecting committee members updates form state', async () => {
      const user = userEvent.setup();
      render(<ReviewAssignmentForm deliverableId="d1" />);

      const checkbox1 = screen.getByTestId('committee-member-member-1');
      const checkbox2 = screen.getByTestId('committee-member-member-2');

      // Select first member
      await user.click(checkbox1);
      expect(checkbox1).toBeChecked();

      // Select second member
      await user.click(checkbox2);
      expect(checkbox2).toBeChecked();

      // Deselect first member
      await user.click(checkbox1);
      expect(checkbox1).not.toBeChecked();
      expect(checkbox2).toBeChecked();
    });
  });

  describe('API Integration - Submit', () => {
    test('submit calls POST /reviews/assign with correct body including reviewDeadlineDays', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockResolvedValue({ success: true });

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill form
      await user.type(screen.getByTestId('deadline-input'), '7');
      await user.type(screen.getByTestId('instructions-input'), 'Review thoroughly');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('committee-member-member-2'));

      // Submit
      await user.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(reviewService.assignReview).toHaveBeenCalledWith(
          expect.objectContaining({
            deliverableId: 'd1',
            reviewDeadlineDays: 7,
            selectedCommitteeMembers: ['member-1', 'member-2'],
            instructions: 'Review thoroughly'
          })
        );
      });
    });

    test('success response shows confirmation message', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockResolvedValue({ success: true });

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('submit-button'));

      // Should show success message
      await waitFor(() => {
        expect(screen.getByText(/Review assignment created successfully/i)).toBeInTheDocument();
      });
    });

    test('success response calls onSuccess callback', async () => {
      const user = userEvent.setup();
      const onSuccess = jest.fn();
      reviewService.assignReview.mockResolvedValue({ success: true });

      render(<ReviewAssignmentForm deliverableId="d1" onSuccess={onSuccess} />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('submit-button'));

      // onSuccess should be called
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    test('form resets after successful submission', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockResolvedValue({ success: true });

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill form
      const deadlineInput = screen.getByTestId('deadline-input');
      const checkbox = screen.getByTestId('committee-member-member-1');
      const instructionsInput = screen.getByTestId('instructions-input');

      await user.type(deadlineInput, '5');
      await user.click(checkbox);
      await user.type(instructionsInput, 'Test instructions');

      // Submit
      await user.click(screen.getByTestId('submit-button'));

      // Wait for success
      await waitFor(() => {
        expect(screen.getByText(/Review assignment created successfully/i)).toBeInTheDocument();
      });

      // Check form was reset
      expect(deadlineInput).toHaveValue(null);
      expect(checkbox).not.toBeChecked();
      expect(instructionsInput).toHaveValue('');
    });
  });

  describe('Error Handling', () => {
    test('API error shows error message with code field', async () => {
      const user = userEvent.setup();
      const errorCode = 'DUPLICATE_ASSIGNMENT';
      reviewService.assignReview.mockRejectedValue({
        response: {
          data: {
            code: errorCode
          }
        }
      });

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('submit-button'));

      // Should show error message with code
      await waitFor(() => {
        expect(screen.getByText(new RegExp(errorCode))).toBeInTheDocument();
      });
    });

    test('generic error message shown when code field missing', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockRejectedValue(new Error('Network error'));

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('submit-button'));

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    test('loading indicator visible during API call', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('submit-button'));

      // Loading indicator should show
      expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    });

    test('submit button disabled during loading', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      const submitBtn = screen.getByTestId('submit-button');
      await user.click(submitBtn);

      // Button should be disabled
      expect(submitBtn).toBeDisabled();
    });

    test('loading state clears after successful submission', async () => {
      const user = userEvent.setup();
      reviewService.assignReview.mockResolvedValue({ success: true });

      render(<ReviewAssignmentForm deliverableId="d1" />);

      // Fill and submit
      await user.type(screen.getByTestId('deadline-input'), '5');
      await user.click(screen.getByTestId('committee-member-member-1'));
      await user.click(screen.getByTestId('submit-button'));

      // Wait for success message
      await waitFor(() => {
        expect(screen.getByText(/Review assignment created successfully/i)).toBeInTheDocument();
      });

      // Loading should be gone
      expect(screen.queryByText(/^Loading\.\.\.$/)).not.toBeInTheDocument();

      // Submit button should be enabled again
      expect(screen.getByTestId('submit-button')).not.toBeDisabled();
    });
  });
});
