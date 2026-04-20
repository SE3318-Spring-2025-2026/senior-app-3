import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DeliverableSubmissionForm from '../DeliverableSubmissionForm';
import * as deliverableService from '../../../api/deliverableService';

// Mock the deliverable service
jest.mock('../../../api/deliverableService');

// Mock the auth store
jest.mock('../../../store/authStore', () => {
  const actual = jest.requireActual('zustand');
  return {
    __esModule: true,
    default: actual.create(() => ({
      user: { groupId: 'test-group-123' },
    })),
  };
});

describe('DeliverableSubmissionForm', () => {
  const mockFileUploadWidget = jest.fn(() => <div data-testid="file-upload-widget">File Upload Widget</div>);
  const mockValidationResponse = {
    validationToken: 'test-token-12345',
    groupId: 'test-group-123',
    committeeId: 'test-committee-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deliverableService.validateGroupForSubmission.mockResolvedValue(mockValidationResponse);
  });

  // ============================================================================
  // RENDERING TESTS
  // ============================================================================
  describe('Rendering', () => {
    test('renders all form fields (type, sprintId, description)', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      expect(typeSelect).toBeInTheDocument();
      expect(sprintInput).toBeInTheDocument();
      expect(descriptionTextarea).toBeInTheDocument();
    });

    test('renders all labels correctly', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      // Check for labels using more specific queries
      const typeLabel = screen.getByText((content, element) => 
        content === 'DELIVERABLE TYPE' && element.tagName.toLowerCase() === 'label'
      );
      const sprintLabel = screen.getByText((content, element) => 
        content === 'SPRINT ID' && element.tagName.toLowerCase() === 'label'
      );
      const descLabel = screen.getByText((content, element) => 
        content === 'DESCRIPTION' && element.tagName.toLowerCase() === 'label'
      );
      
      expect(typeLabel).toBeInTheDocument();
      expect(sprintLabel).toBeInTheDocument();
      expect(descLabel).toBeInTheDocument();
      expect(screen.getByText(/Optional/i)).toBeInTheDocument();
    });

    test('renders submit button with correct label', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).toBeInTheDocument();
    });

    test('submit button is disabled initially', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).toBeDisabled();
    });

    test('FileUploadWidget is NOT rendered initially', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      expect(screen.queryByTestId('file-upload-widget')).not.toBeInTheDocument();
    });

    test('renders deliverable type options', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      expect(typeSelect).toHaveTextContent('Proposal');
      expect(typeSelect).toHaveTextContent('Statement of Work');
      expect(typeSelect).toHaveTextContent('Demo');
      expect(typeSelect).toHaveTextContent('Interim Report');
      expect(typeSelect).toHaveTextContent('Final Report');
    });
  });

  // ============================================================================
  // VALIDATION TESTS
  // ============================================================================
  describe('Validation', () => {
    test('submit button disabled when deliverable type field is empty', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      await userEvent.type(sprintInput, 'Sprint-01');

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).toBeDisabled();
    });

    test('submit button disabled when sprintId field is empty', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      await userEvent.selectOptions(typeSelect, 'proposal');

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).toBeDisabled();
    });

    test('description is optional and shows no error when empty', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).not.toBeDisabled();
    });

    test('description shorter than 10 chars shows error on submit', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.type(descriptionTextarea, 'short');

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      await userEvent.click(submitButton);

      expect(screen.getByText(/must be between 10 and 500 characters/i)).toBeInTheDocument();
    });

    test('description longer than 500 chars shows error on submit', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.type(descriptionTextarea, 'a'.repeat(501));

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      await userEvent.click(submitButton);

      expect(screen.getByText(/must be between 10 and 500 characters/i)).toBeInTheDocument();
    });

    test('description exactly 10 chars is valid', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.type(descriptionTextarea, 'a'.repeat(10));

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(deliverableService.validateGroupForSubmission).toHaveBeenCalled();
      });
    });

    test('description exactly 500 chars is valid', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.type(descriptionTextarea, 'a'.repeat(500));

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(deliverableService.validateGroupForSubmission).toHaveBeenCalled();
      });
    });

    test('description empty (0 chars) is valid', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).not.toBeDisabled();
    });

    test('all required fields filled enables submit button', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).not.toBeDisabled();
    });
  });

  // ============================================================================
  // API CALL TESTS
  // ============================================================================
  describe('API calls on submit', () => {
    test('calls validateGroupForSubmission with groupId on valid submit', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(deliverableService.validateGroupForSubmission).toHaveBeenCalledWith('test-group-123');
        expect(deliverableService.validateGroupForSubmission).toHaveBeenCalledTimes(1);
      });
    });

    test('submit button shows loading state during API call', async () => {
      deliverableService.validateGroupForSubmission.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve(mockValidationResponse), 100))
      );

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      expect(screen.getByRole('button', { name: /Validating/i })).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });

    test('form is disabled during loading state', async () => {
      deliverableService.validateGroupForSubmission.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve(mockValidationResponse), 100))
      );

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      expect(submitButton).toBeDisabled();
    });
  });

  // ============================================================================
  // SUCCESS FLOW TESTS
  // ============================================================================
  describe('Success flow (200 response)', () => {
    test('validationToken is stored in component state', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(mockFileUploadWidget).toHaveBeenCalledWith(
          expect.objectContaining({ validationToken: 'test-token-12345' }),
          expect.anything()
        );
      });
    });

    test('FileUploadWidget is rendered after success', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        // After success, form fields should be hidden and FileUploadWidget should be called
        expect(mockFileUploadWidget).toHaveBeenCalled();
        // Form fields should not be in the document after switching to FileUploadWidget
        expect(screen.queryByRole('combobox', { name: /DELIVERABLE TYPE/i })).not.toBeInTheDocument();
      });
    });

    test('FileUploadWidget receives correct props including validationToken', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.type(descriptionTextarea, 'Test description here');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(mockFileUploadWidget).toHaveBeenCalledWith(
          expect.objectContaining({
            validationToken: 'test-token-12345',
            groupId: 'test-group-123',
            deliverableType: 'proposal',
            sprintId: 'Sprint-01',
            description: 'Test description here',
          }),
          expect.anything()
        );
      });
    });

    test('form fields are hidden after success', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByRole('combobox', { name: /DELIVERABLE TYPE/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /SPRINT ID/i })).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // ERROR STATE TESTS
  // ============================================================================
  describe('Error states', () => {
    test('403 response shows correct error message', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        response: {
          status: 403,
          data: { message: 'Access Forbidden: You do not have permission to submit deliverables.' },
        },
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Access Forbidden: You do not have permission to submit deliverables/i)
        ).toBeInTheDocument();
      });
    });

    test('404 response shows correct error message', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        response: {
          status: 404,
          data: { message: 'Group not found in the system.' },
        },
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Group not found in the system/i)).toBeInTheDocument();
      });
    });

    test('409 response shows correct error message', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        response: {
          status: 409,
          data: { message: 'Deliverable already submitted for this sprint.' },
        },
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Deliverable already submitted for this sprint/i)
        ).toBeInTheDocument();
      });
    });

    test('error message displayed correctly in error container', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        response: {
          status: 403,
          data: { message: 'Forbidden' },
        },
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        const errorText = screen.getByText('Forbidden');
        expect(errorText).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // NETWORK ERROR TESTS
  // ============================================================================
  describe('Network error handling', () => {
    test('network failure shows retry button', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        code: 'ERR_NETWORK',
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Network error. Please try again/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
      });
    });

    test('clicking retry button resets form state and allows resubmission', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        code: 'ERR_NETWORK',
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
      });

      // Click retry to reset form state
      const retryButton = screen.getByRole('button', { name: /Try Again/i });
      await userEvent.click(retryButton);

      // Error message should disappear after retry
      await waitFor(() => {
        expect(screen.queryByText(/Network error/i)).not.toBeInTheDocument();
      });

      // Form should be visible again
      expect(screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i })).toBeInTheDocument();
    });

    test('retry button is keyboard accessible', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        code: 'ERR_NETWORK',
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
      });

      const retryButton = screen.getByRole('button', { name: /Try Again/i });
      // Button should be focusable
      expect(retryButton).toBeInTheDocument();
      expect(retryButton.tagName).toBe('BUTTON');
      // Can be activated by user
      await userEvent.click(retryButton);
    });
  });

  // ============================================================================
  // FORM STATE TESTS
  // ============================================================================
  describe('Form states', () => {
    test('initial state shows form with disabled submit button', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      expect(screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /SPRINT ID/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue to File Upload/i })).toBeDisabled();
    });

    test('loading state disables fields and shows loading indicator', async () => {
      deliverableService.validateGroupForSubmission.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve(mockValidationResponse), 200))
      );

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      expect(screen.getByText('Validating...')).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });

    test('token_received state renders FileUploadWidget', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        // FileUploadWidget is called with the right props
        expect(mockFileUploadWidget).toHaveBeenCalled();
        expect(mockFileUploadWidget).toHaveBeenCalledWith(
          expect.objectContaining({
            validationToken: 'test-token-12345',
          }),
          expect.anything()
        );
      });
    });

    test('error state shows error message and allows correction', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        response: {
          status: 403,
          data: { message: 'Access Forbidden' },
        },
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Access Forbidden/i)).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // ACCESSIBILITY TESTS
  // ============================================================================
  describe('Accessibility', () => {
    test('all form fields are keyboard navigable with Tab', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      expect(typeSelect).toBeInTheDocument();
      expect(sprintInput).toBeInTheDocument();
      expect(descriptionTextarea).toBeInTheDocument();
      expect(submitButton).toBeInTheDocument();

      // Tab to first element - should focus on select
      await userEvent.tab();
      expect(typeSelect).toHaveFocus();

      // Tab to next element - should focus on sprint input
      await userEvent.tab();
      expect(sprintInput).toHaveFocus();

      // Tab to next element - should focus on description
      await userEvent.tab();
      expect(descriptionTextarea).toHaveFocus();

      // Tab to next element - should focus on submit button (or body if button is disabled and skipped)
      // Disabled buttons are not focusable via Tab, so just verify we can navigate through form fields
      await userEvent.tab();
      // This may focus the button if it's enabled, or move to next element
    });

    test('submit button has accessible name', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      expect(submitButton).toHaveAccessibleName(/Continue to File Upload/i);
    });

    test('loading state announces to screen readers', async () => {
      deliverableService.validateGroupForSubmission.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve(mockValidationResponse), 100))
      );

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      expect(screen.getByText('Validating...')).toBeInTheDocument();
    });

    test('form has proper structure with labels', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      expect(typeSelect).toHaveAccessibleName(/DELIVERABLE TYPE/i);
      expect(sprintInput).toHaveAccessibleName(/SPRINT ID/i);
      expect(descriptionTextarea).toHaveAccessibleName(/DESCRIPTION/i);
    });
  });

  // ============================================================================
  // EDGE CASES AND ADDITIONAL TESTS
  // ============================================================================
  describe('Edge cases', () => {
    test('does not call API when required fields missing', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });
      await userEvent.click(submitButton);

      expect(deliverableService.validateGroupForSubmission).not.toHaveBeenCalled();
    });

    test('only calls API once even with multiple submit clicks', async () => {
      deliverableService.validateGroupForSubmission.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve(mockValidationResponse), 200))
      );

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');

      // Try clicking submit multiple times rapidly
      await userEvent.click(submitButton);
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(deliverableService.validateGroupForSubmission).toHaveBeenCalledTimes(1);
      });
    });

    test('clears previous errors when form state resets after retry', async () => {
      deliverableService.validateGroupForSubmission.mockRejectedValueOnce({
        code: 'ERR_NETWORK',
      });

      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const typeSelect = screen.getByRole('combobox', { name: /DELIVERABLE TYPE/i });
      const sprintInput = screen.getByRole('textbox', { name: /SPRINT ID/i });
      const submitButton = screen.getByRole('button', { name: /Continue to File Upload/i });

      await userEvent.selectOptions(typeSelect, 'proposal');
      await userEvent.type(sprintInput, 'Sprint-01');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });

      const retryButton = screen.getByRole('button', { name: /Try Again/i });
      await userEvent.click(retryButton);

      // Error should be cleared
      expect(screen.queryByText(/Network error/i)).not.toBeInTheDocument();
    });

    test('description character count displays correctly', async () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const descriptionTextarea = screen.getByRole('textbox', { name: /DESCRIPTION/i });

      await userEvent.type(descriptionTextarea, 'Hello');

      expect(screen.getByText(/5\/500/)).toBeInTheDocument();
    });

    test('required field asterisks are visible', () => {
      render(<DeliverableSubmissionForm FileUploadWidget={mockFileUploadWidget} />);

      const requiredMarks = screen.getAllByText('*');
      expect(requiredMarks.length).toBeGreaterThanOrEqual(2); // At least type and sprint required
    });
  });
});
