import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ReviewAssignmentForm from '../ReviewAssignmentForm';
import { assignReview, getCommitteeCandidates } from '../../../api/reviewAPI';

jest.mock('../../../api/reviewAPI');

const mockDeliverable = {
  deliverableId: 'd1',
  deliverableType: 'proposal',
  groupId: 'group-1',
};

const mockCandidates = [
  { id: 'member-1', name: 'Alice', email: 'alice@test.com' },
  { id: 'member-2', name: 'Bob', email: 'bob@test.com' },
  { id: 'member-3', name: 'Carol', email: 'carol@test.com' },
];

// Helper: render the form and wait for committee candidates to load
async function renderAndWait(props = {}) {
  const defaults = {
    deliverable: mockDeliverable,
    onSuccess: jest.fn(),
    onCancel: jest.fn(),
  };
  render(<ReviewAssignmentForm {...defaults} {...props} />);
  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
}

describe('ReviewAssignmentForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCommitteeCandidates.mockResolvedValue({ candidates: mockCandidates });
  });

  // ── Form Rendering ────────────────────────────────────────────────────────

  describe('Form Rendering', () => {
    test('renders the form with Assign Reviewers heading', async () => {
      await renderAndWait();
      expect(screen.getByRole('heading', { name: /Assign Reviewers/i })).toBeInTheDocument();
    });

    test('renders review deadline input with default value 7', async () => {
      await renderAndWait();
      const input = screen.getByLabelText(/Review Deadline \(Days\)/i);
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue(7);
    });

    test('renders committee member multi-select after candidates load', async () => {
      await renderAndWait();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Alice/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Bob/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Carol/i })).toBeInTheDocument();
    });

    test('renders instructions textarea', async () => {
      await renderAndWait();
      expect(screen.getByLabelText(/Review Instructions/i)).toBeInTheDocument();
    });

    test('renders Assign Reviewers submit button', async () => {
      await renderAndWait();
      expect(screen.getByRole('button', { name: /Assign Reviewers/i })).toBeInTheDocument();
    });
  });

  // ── Form Validation ───────────────────────────────────────────────────────

  describe('Form Validation', () => {
    test('reviewDeadlineDays required — submission prevented when deadline is cleared', async () => {
      const user = userEvent.setup();
      await renderAndWait();

      await user.clear(screen.getByLabelText(/Review Deadline \(Days\)/i));
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Review deadline must be between/i);
      });
      expect(assignReview).not.toHaveBeenCalled();
    });

    test('submit button is not disabled when deadline field is empty (validation fires on submit)', async () => {
      const user = userEvent.setup();
      await renderAndWait();

      await user.clear(screen.getByLabelText(/Review Deadline \(Days\)/i));
      // Button should still be enabled (not pre-disabled) — validation happens on submit
      expect(screen.getByRole('button', { name: /Assign Reviewers/i })).not.toBeDisabled();
    });

    test('submission prevented when deadline exceeds 30 days', async () => {
      const user = userEvent.setup();
      await renderAndWait();

      const deadlineInput = screen.getByLabelText(/Review Deadline \(Days\)/i);
      await user.clear(deadlineInput);
      await user.type(deadlineInput, '99');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Review deadline must be between/i);
      });
      expect(assignReview).not.toHaveBeenCalled();
    });
  });

  // ── Multi-Select Functionality ────────────────────────────────────────────

  describe('Multi-Select Functionality', () => {
    test('selectedCommitteeMembers multi-select: select and deselect members', async () => {
      const user = userEvent.setup();
      await renderAndWait();

      const select = screen.getByRole('listbox');
      await user.selectOptions(select, ['member-1', 'member-2']);

      expect(screen.getByRole('option', { name: 'Alice (alice@test.com)' })).toHaveProperty(
        'selected',
        true
      );
      expect(screen.getByRole('option', { name: 'Bob (bob@test.com)' })).toHaveProperty(
        'selected',
        true
      );

      await user.deselectOptions(select, ['member-1']);

      expect(screen.getByRole('option', { name: 'Alice (alice@test.com)' })).toHaveProperty(
        'selected',
        false
      );
      expect(screen.getByRole('option', { name: 'Bob (bob@test.com)' })).toHaveProperty(
        'selected',
        true
      );
    });
  });

  // ── API Integration ───────────────────────────────────────────────────────

  describe('API Integration - Submit', () => {
    test('submit calls POST /reviews/assign with correct body including reviewDeadlineDays', async () => {
      const user = userEvent.setup();
      assignReview.mockResolvedValue({ success: true, assignedCount: 2 });
      await renderAndWait();

      const deadlineInput = screen.getByLabelText(/Review Deadline \(Days\)/i);
      await user.clear(deadlineInput);
      await user.type(deadlineInput, '7');

      await user.selectOptions(screen.getByRole('listbox'), ['member-1', 'member-2']);
      await user.type(screen.getByLabelText(/Review Instructions/i), 'Review thoroughly');

      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(assignReview).toHaveBeenCalledWith(
          expect.objectContaining({
            deliverableId: 'd1',
            reviewDeadlineDays: 7,
            selectedCommitteeMembers: ['member-1', 'member-2'],
            instructions: 'Review thoroughly',
          })
        );
      });
    });

    test('success response shows confirmation message', async () => {
      const user = userEvent.setup();
      assignReview.mockResolvedValue({ success: true, assignedCount: 1 });
      await renderAndWait();

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(screen.getByText(/Review assignment successful/i)).toBeInTheDocument();
      });
    });

    test('success response calls onSuccess callback', async () => {
      const user = userEvent.setup();
      const onSuccess = jest.fn();
      assignReview.mockResolvedValue({ success: true, assignedCount: 1 });
      await renderAndWait({ onSuccess });

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalled(), { timeout: 4000 });
    }, 8000);
  });

  // ── Error Handling ────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    test('API error shows error message with code field', async () => {
      const user = userEvent.setup();
      assignReview.mockRejectedValue({
        response: {
          data: { message: 'Review already assigned', code: 'DUPLICATE_ASSIGNMENT' },
        },
      });
      await renderAndWait();

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(screen.getByText(/DUPLICATE_ASSIGNMENT/)).toBeInTheDocument();
      });
    });

    test('generic error message shown when code field missing', async () => {
      const user = userEvent.setup();
      assignReview.mockRejectedValue({
        response: { data: { message: 'Server error' } },
      });
      await renderAndWait();

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(screen.getByText(/Server error/i)).toBeInTheDocument();
      });
    });
  });

  // ── Loading States ────────────────────────────────────────────────────────

  describe('Loading States', () => {
    test('loading indicator visible during API call', async () => {
      const user = userEvent.setup();
      assignReview.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
      );
      await renderAndWait();

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      expect(screen.getByText(/Assigning\.\.\./i)).toBeInTheDocument();
    });

    test('submit button is disabled during API call', async () => {
      const user = userEvent.setup();
      assignReview.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
      );
      await renderAndWait();

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      const submitBtn = screen.getByRole('button', { name: /Assign Reviewers/i });
      await user.click(submitBtn);

      expect(submitBtn).toBeDisabled();
    });

    test('loading state clears after successful submission', async () => {
      const user = userEvent.setup();
      assignReview.mockResolvedValue({ success: true, assignedCount: 1 });
      await renderAndWait();

      await user.selectOptions(screen.getByRole('listbox'), 'member-1');
      await user.click(screen.getByRole('button', { name: /Assign Reviewers/i }));

      await waitFor(() => {
        expect(screen.getByText(/Review assignment successful/i)).toBeInTheDocument();
      });

      expect(screen.queryByText(/Assigning\.\.\./i)).not.toBeInTheDocument();
    });
  });
});
