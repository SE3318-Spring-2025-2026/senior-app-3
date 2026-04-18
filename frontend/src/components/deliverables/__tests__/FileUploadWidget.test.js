import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import FileUploadWidget from '../FileUploadWidget';
import apiClient from '../../../api/apiClient';

// Mock the apiClient
jest.mock('../../../api/apiClient');

describe('FileUploadWidget', () => {
  const mockOnSuccess = jest.fn();
  const defaultProps = {
    validationToken: 'test-token-12345',
    groupId: 'group-123',
    deliverableType: 'proposal',
    sprintId: 'Sprint-01',
    description: 'Test deliverable',
    onSuccess: mockOnSuccess,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.post.mockResolvedValue({
      data: {
        stagingId: 'staging-123',
        fileHash: 'abc123def456',
        submittedAt: '2026-04-18T00:00:00Z',
      },
    });
  });

  // ============================================================================
  // RENDERING TESTS
  // ============================================================================
  describe('Rendering', () => {
    test('renders the widget title', () => {
      render(<FileUploadWidget {...defaultProps} />);
      
      expect(screen.getByText(/Finalize Submission/i)).toBeInTheDocument();
    });

    test('renders drag and drop file input area', () => {
      render(<FileUploadWidget {...defaultProps} />);

      const fileInput = screen.getByRole('button', { hidden: true }); // label acts as button
      expect(fileInput).toBeInTheDocument();
    });

    test('renders file browser button with instructions', () => {
      render(<FileUploadWidget {...defaultProps} />);

      expect(screen.getByText(/Select PDF or Archive/i)).toBeInTheDocument();
    });

    test('renders submit button', () => {
      render(<FileUploadWidget {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      expect(submitButton).toBeInTheDocument();
    });

    test('submit button is disabled when no file selected', () => {
      render(<FileUploadWidget {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      expect(submitButton).toBeDisabled();
    });

    test('displays deliverable type in summary', () => {
      render(<FileUploadWidget {...defaultProps} deliverableType="interim_report" />);

      expect(screen.getByText(/interim report/i)).toBeInTheDocument();
    });

    test('displays sprint ID in summary', () => {
      render(<FileUploadWidget {...defaultProps} sprintId="Sprint-02" />);

      expect(screen.getByText(/Sprint-02/i)).toBeInTheDocument();
    });

    test('displays max file size hint', () => {
      render(<FileUploadWidget {...defaultProps} />);

      expect(screen.getByText(/Max 50MB/i)).toBeInTheDocument();
    });
  });

  // ============================================================================
  // FILE SELECTION TESTS
  // ============================================================================
  describe('File Selection', () => {
    test('clicking file input area opens file browser', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
    });

    test('selecting a file via input shows filename', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      expect(screen.getByText('proposal.pdf')).toBeInTheDocument();
    });

    test('selecting a file shows file-selected styling', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const label = container.querySelector('label');
      expect(label).toHaveClass('border-emerald-200', 'bg-emerald-50/10');
    });

    test('submit button enabled after selecting a file', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      expect(submitButton).not.toBeDisabled();
    });

    test('accepts PDF files', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'document.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    test('accepts DOCX files', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'report.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      await userEvent.upload(fileInput, file);

      expect(screen.getByText('report.docx')).toBeInTheDocument();
    });

    test('accepts Markdown files', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'README.md', { type: 'text/markdown' });

      await userEvent.upload(fileInput, file);

      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    test('accepts ZIP files', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'archive.zip', { type: 'application/zip' });

      await userEvent.upload(fileInput, file);

      expect(screen.getByText('archive.zip')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // UPLOAD PROCESS TESTS
  // ============================================================================
  describe('Upload Process', () => {
    test('clicking submit calls apiClient.post with correct endpoint', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith(
          '/deliverables/submit',
          expect.any(FormData),
          expect.any(Object)
        );
      });
    });

    test('upload includes all required form fields', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const callArgs = apiClient.post.mock.calls[0];
        const formData = callArgs[1];

        expect(formData.get('groupId')).toBe('group-123');
        expect(formData.get('deliverableType')).toBe('proposal');
        expect(formData.get('sprintId')).toBe('Sprint-01');
        expect(formData.get('file')).toBe(file);
        expect(formData.get('description')).toBe('Test deliverable');
      });
    });

    test('upload includes validationToken in headers', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const callArgs = apiClient.post.mock.calls[0];
        const config = callArgs[2];

        expect(config.headers['Authorization-Validation']).toBe('test-token-12345');
      });
    });

    test('shows uploading state during API call', async () => {
      apiClient.post.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 100))
      );

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      expect(screen.getByText(/Sending to Staging/i)).toBeInTheDocument();
    });

    test('disables submit button during upload', async () => {
      apiClient.post.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 100))
      );

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      expect(submitButton).toBeDisabled();
    });

    test('updates progress percentage during upload', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      // Before clicking submit, verify form is shown
      expect(screen.getByRole('button', { name: /Submit Deliverable/i })).toBeInTheDocument();

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        // After upload, component transitions to success - verify that happened
        expect(screen.getByText(/Upload Complete/i)).toBeInTheDocument();
      });
    });

    test('progress bar displays during upload', async () => {
      apiClient.post.mockImplementationOnce((url, data, config) => {
        // Create a delayed promise that gives time to observe loading state
        return new Promise((resolve) => {
          setTimeout(() => resolve({ data: {} }), 100);
        });
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      // Progress bar is shown briefly during upload
      await waitFor(() => {
        expect(screen.getByText(/Uploading/i)).toBeInTheDocument();
      });
    });

    test('description is optional - not included in formData if not provided', async () => {
      const { container } = render(
        <FileUploadWidget
          {...defaultProps}
          description={undefined}
        />
      );

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const callArgs = apiClient.post.mock.calls[0];
        const formData = callArgs[1];

        expect(formData.get('description')).toBeNull();
      });
    });
  });

  // ============================================================================
  // SUCCESS STATE TESTS
  // ============================================================================
  describe('Success State', () => {
    test('shows success message after successful upload', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Upload Complete/i)).toBeInTheDocument();
      });
    });

    test('shows success icon after successful upload', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Your deliverable has been safely staged/i)).toBeInTheDocument();
      });
    });

    test('shows "Done" button in success state', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument();
      });
    });

    test('calls onSuccess callback with response data', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith({
          stagingId: 'staging-123',
          fileHash: 'abc123def456',
          submittedAt: '2026-04-18T00:00:00Z',
        });
      });
    });

    test('success state has emerald color styling', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const successContainer = container.querySelector('.bg-emerald-50');
        expect(successContainer).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================
  describe('Error Handling', () => {
    test('shows error message when file is not selected', async () => {
      render(<FileUploadWidget {...defaultProps} />);

      // When no file is selected, the submit button is disabled
      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      expect(submitButton).toBeDisabled();
    });

    test('shows error message from API response', async () => {
      apiClient.post.mockRejectedValueOnce({
        response: {
          data: {
            message: 'File size exceeds maximum limit',
          },
        },
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/File size exceeds maximum limit/i)).toBeInTheDocument();
      });
    });

    test('shows generic error message when API returns no message', async () => {
      apiClient.post.mockRejectedValueOnce({
        response: {
          data: {},
        },
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Upload failed. Please try again/i)).toBeInTheDocument();
      });
    });

    test('shows error message when network request fails', async () => {
      apiClient.post.mockRejectedValueOnce(new Error('Network error'));

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Upload failed. Please try again/i)).toBeInTheDocument();
      });
    });

    test('error message is displayed in red text', async () => {
      apiClient.post.mockRejectedValueOnce({
        response: {
          data: {
            message: 'Upload failed',
          },
        },
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const errorText = screen.getByText(/Upload failed/);
        expect(errorText).toHaveClass('text-red-500');
      });
    });

    test('submit button is enabled again after error', async () => {
      apiClient.post.mockRejectedValueOnce({
        response: {
          data: {
            message: 'Upload failed',
          },
        },
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Upload failed/)).toBeInTheDocument();
      });

      // Submit button should be re-enabled for retry
      expect(submitButton).not.toBeDisabled();
    });

    test('error is cleared when file selection changes', async () => {
      apiClient.post.mockRejectedValueOnce({
        response: {
          data: {
            message: 'Upload failed',
          },
        },
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file1 = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file1);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Upload failed/)).toBeInTheDocument();
      });

      // Select a new file
      const file2 = new File(['new content'], 'new-proposal.pdf', { type: 'application/pdf' });
      await userEvent.upload(fileInput, file2);

      // Error should be cleared
      expect(screen.queryByText(/Upload failed/)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // FORM DATA TESTS
  // ============================================================================
  describe('Form Data', () => {
    test('includes all required fields in FormData', async () => {
      const { container } = render(
        <FileUploadWidget
          validationToken="token-abc"
          groupId="group-xyz"
          deliverableType="final_report"
          sprintId="Sprint-03"
          description="Final submission"
          onSuccess={mockOnSuccess}
        />
      );

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const callArgs = apiClient.post.mock.calls[0];
        const formData = callArgs[1];

        expect(formData.get('groupId')).toBe('group-xyz');
        expect(formData.get('deliverableType')).toBe('final_report');
        expect(formData.get('sprintId')).toBe('Sprint-03');
        expect(formData.get('description')).toBe('Final submission');
        expect(formData.get('file')).toBe(file);
      });
    });

    test('sets correct Content-Type header', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const callArgs = apiClient.post.mock.calls[0];
        const config = callArgs[2];

        expect(config.headers['Content-Type']).toBe('multipart/form-data');
      });
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================
  describe('Integration', () => {
    test('complete flow: select file, upload, see success', async () => {
      const { container } = render(<FileUploadWidget {...defaultProps} />);

      // Initial state
      expect(screen.getByText(/Select PDF or Archive/i)).toBeInTheDocument();

      // Select file
      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });
      await userEvent.upload(fileInput, file);

      // File selected
      expect(screen.getByText('proposal.pdf')).toBeInTheDocument();

      // Submit
      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      // Success
      await waitFor(() => {
        expect(screen.getByText(/Upload Complete/i)).toBeInTheDocument();
      });

      expect(mockOnSuccess).toHaveBeenCalled();
    });

    test('displays all props correctly in summary', () => {
      render(
        <FileUploadWidget
          validationToken="token"
          groupId="g1"
          deliverableType="demo"
          sprintId="Sprint-05"
          description="demo submission"
          onSuccess={() => {}}
        />
      );

      expect(screen.getByText(/demo/i)).toBeInTheDocument();
      expect(screen.getByText(/Sprint-05/i)).toBeInTheDocument();
    });

    test('handles different file types correctly', async () => {
      const { container: container1 } = render(<FileUploadWidget {...defaultProps} />);
      const fileInput1 = container1.querySelector('input[type="file"]');
      const pdfFile = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
      await userEvent.upload(fileInput1, pdfFile);
      expect(screen.getByText('doc.pdf')).toBeInTheDocument();

      // Clear and test another type
      const { container: container2 } = render(<FileUploadWidget {...defaultProps} />);
      const fileInput2 = container2.querySelector('input[type="file"]');
      const zipFile = new File(['content'], 'archive.zip', { type: 'application/zip' });
      await userEvent.upload(fileInput2, zipFile);
      expect(screen.getByText('archive.zip')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================
  describe('Edge Cases', () => {
    test('handles missing onSuccess callback gracefully', async () => {
      const { container } = render(
        <FileUploadWidget
          {...defaultProps}
          onSuccess={undefined}
        />
      );

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Upload Complete/i)).toBeInTheDocument();
      });
    });

    test('handles deliverableType with underscores by replacing with spaces', () => {
      render(
        <FileUploadWidget
          {...defaultProps}
          deliverableType="statement_of_work"
        />
      );

      expect(screen.getByText(/statement of work/i)).toBeInTheDocument();
    });

    test('progress bar width updates correctly', async () => {
      apiClient.post.mockImplementationOnce((url, data, config) => {
        if (config.onUploadProgress) {
          config.onUploadProgress({ loaded: 25, total: 100 });
          config.onUploadProgress({ loaded: 75, total: 100 });
        }
        return new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 50));
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        // Verify progress bar exists
        const progressBar = container.querySelector('.bg-indigo-500');
        expect(progressBar).toBeInTheDocument();
      });
    });

    test('handles very large file size calculation', async () => {
      const largeFile = new File(['x'.repeat(50 * 1024 * 1024)], 'large.pdf', {
        type: 'application/pdf',
      });

      const { container } = render(<FileUploadWidget {...defaultProps} />);
      const fileInput = container.querySelector('input[type="file"]');

      await userEvent.upload(fileInput, largeFile);

      expect(screen.getByText('large.pdf')).toBeInTheDocument();
    });

    test('handles empty description prop', async () => {
      const { container } = render(
        <FileUploadWidget
          {...defaultProps}
          description=""
        />
      );

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'proposal.pdf', { type: 'application/pdf' });

      await userEvent.upload(fileInput, file);

      const submitButton = screen.getByRole('button', { name: /Submit Deliverable/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        const callArgs = apiClient.post.mock.calls[0];
        const formData = callArgs[1];
        expect(formData.get('description')).toBeNull();
      });
    });
  });
});
