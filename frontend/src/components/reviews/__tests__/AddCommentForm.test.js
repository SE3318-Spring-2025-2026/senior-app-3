import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddCommentForm from '../AddCommentForm';
import { addComment } from '../../../api/reviewAPI';
import useAuthStore from '../../../store/authStore';

jest.mock('../../../api/reviewAPI');
jest.mock('../../../store/authStore');

const PROF_USER = Object.freeze({ userId: 'u1', username: 'prof1', role: 'professor' });
const COORD_USER = Object.freeze({ userId: 'u2', username: 'coord1', role: 'coordinator' });
const STUDENT_USER = Object.freeze({ userId: 'u3', username: 'student1', role: 'student' });

function renderForm(props = {}) {
  const defaults = {
    deliverableId: 'del-1',
    onCommentAdded: jest.fn(),
    disabled: false,
  };
  return render(<AddCommentForm {...defaults} {...props} />);
}

describe('AddCommentForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) => selector({ user: PROF_USER }));
    addComment.mockResolvedValue({ commentId: 'c-new' });
  });

  // ── Form Rendering (criterion 11) ─────────────────────────────────────────

  describe('Form Rendering', () => {
    test('renders content textarea', () => {
      renderForm();
      expect(screen.getByLabelText('Comment content')).toBeInTheDocument();
    });

    test('renders comment type select', () => {
      renderForm();
      expect(screen.getByRole('combobox', { name: /Comment type/i })).toBeInTheDocument();
    });

    test('renders section number input', () => {
      renderForm();
      expect(screen.getByLabelText('Section number')).toBeInTheDocument();
    });

    test('renders submit (Post Comment) button', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Submit comment' })).toBeInTheDocument();
    });

    test('renders clear button', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Clear form' })).toBeInTheDocument();
    });

    test('comment type select has all 5 options', () => {
      renderForm();
      const select = screen.getByRole('combobox', { name: /Comment type/i });
      const options = Array.from(select.querySelectorAll('option'));
      expect(options).toHaveLength(5);
      const values = options.map((o) => o.value);
      expect(values).toContain('general');
      expect(values).toContain('question');
      expect(values).toContain('clarification_required');
      expect(values).toContain('suggestion');
      expect(values).toContain('praise');
    });
  });

  // ── needsResponse Checkbox (criteria 12 & 13) ─────────────────────────────

  describe('needsResponse Checkbox', () => {
    test('checkbox NOT shown by default (general type)', () => {
      renderForm();
      expect(
        screen.queryByRole('checkbox', { name: /needing response/i })
      ).not.toBeInTheDocument();
    });

    test('checkbox shown when commentType is clarification_required', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Comment type/i }),
        'clarification_required'
      );
      expect(
        screen.getByRole('checkbox', { name: /needing response/i })
      ).toBeInTheDocument();
    });

    test('checkbox NOT shown for question type', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Comment type/i }),
        'question'
      );
      expect(
        screen.queryByRole('checkbox', { name: /needing response/i })
      ).not.toBeInTheDocument();
    });

    test('checkbox NOT shown for suggestion type', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Comment type/i }),
        'suggestion'
      );
      expect(
        screen.queryByRole('checkbox', { name: /needing response/i })
      ).not.toBeInTheDocument();
    });

    test('checkbox NOT shown for praise type', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Comment type/i }),
        'praise'
      );
      expect(
        screen.queryByRole('checkbox', { name: /needing response/i })
      ).not.toBeInTheDocument();
    });

    test('checkbox disappears when switching away from clarification_required', async () => {
      const user = userEvent.setup();
      renderForm();
      const typeSelect = screen.getByRole('combobox', { name: /Comment type/i });
      await user.selectOptions(typeSelect, 'clarification_required');
      expect(
        screen.getByRole('checkbox', { name: /needing response/i })
      ).toBeInTheDocument();
      await user.selectOptions(typeSelect, 'general');
      expect(
        screen.queryByRole('checkbox', { name: /needing response/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── Submit Disabled When Empty (criterion 14) ─────────────────────────────

  describe('Submit Disabled When Content Empty', () => {
    test('submit button disabled initially (empty content)', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Submit comment' })).toBeDisabled();
    });

    test('submit button enabled after content is entered', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Hello');
      expect(screen.getByRole('button', { name: 'Submit comment' })).not.toBeDisabled();
    });

    test('submit button disabled again when content cleared', async () => {
      const user = userEvent.setup();
      renderForm();
      const textarea = screen.getByLabelText('Comment content');
      await user.type(textarea, 'Hello');
      await user.clear(textarea);
      expect(screen.getByRole('button', { name: 'Submit comment' })).toBeDisabled();
    });

    test('whitespace-only content keeps submit disabled', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), '   ');
      expect(screen.getByRole('button', { name: 'Submit comment' })).toBeDisabled();
    });
  });

  // ── API Submit (criterion 15) ─────────────────────────────────────────────

  describe('API Integration - Submit', () => {
    test('submit calls addComment with deliverableId, content, and commentType', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test comment text');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => {
        expect(addComment).toHaveBeenCalledWith(
          expect.objectContaining({
            deliverableId: 'del-1',
            content: 'Test comment text',
            commentType: 'general',
          })
        );
      });
    });

    test('submit sends needsResponse: false when type is not clarification_required', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test comment');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => {
        expect(addComment).toHaveBeenCalledWith(
          expect.objectContaining({ needsResponse: false })
        );
      });
    });

    test('submit sends needsResponse: true when checkbox is checked for clarification_required', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Comment type/i }),
        'clarification_required'
      );
      await user.click(screen.getByRole('checkbox', { name: /needing response/i }));
      await user.type(screen.getByLabelText('Comment content'), 'Clarify this');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => {
        expect(addComment).toHaveBeenCalledWith(
          expect.objectContaining({
            commentType: 'clarification_required',
            needsResponse: true,
          })
        );
      });
    });

    test('submit sends sectionNumber as integer when provided', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Section comment');
      await user.type(screen.getByLabelText('Section number'), '3');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => {
        expect(addComment).toHaveBeenCalledWith(
          expect.objectContaining({ sectionNumber: 3 })
        );
      });
    });

    test('success: onCommentAdded callback is called (criterion 16)', async () => {
      const user = userEvent.setup();
      const onCommentAdded = jest.fn();
      renderForm({ onCommentAdded });
      await user.type(screen.getByLabelText('Comment content'), 'My comment');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => expect(onCommentAdded).toHaveBeenCalled());
    });

    test('success: shows confirmation message', async () => {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'My comment');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() =>
        expect(screen.getByText(/Comment added successfully/i)).toBeInTheDocument()
      );
    });

    test('success: form content is cleared after submit', async () => {
      const user = userEvent.setup();
      renderForm();
      const textarea = screen.getByLabelText('Comment content');
      await user.type(textarea, 'My comment');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => expect(addComment).toHaveBeenCalled());
      expect(textarea).toHaveValue('');
    });
  });

  // ── Loading State (criterion 26) ──────────────────────────────────────────

  describe('Loading States', () => {
    test('submit button shows Submitting... during API call', async () => {
      const user = userEvent.setup();
      addComment.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ commentId: 'c-new' }), 100))
      );
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      expect(screen.getByText('Submitting...')).toBeInTheDocument();
    });

    test('submit button disabled during API call', async () => {
      const user = userEvent.setup();
      addComment.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ commentId: 'c-new' }), 100))
      );
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test');
      const submitBtn = screen.getByRole('button', { name: 'Submit comment' });
      await user.click(submitBtn);
      expect(submitBtn).toBeDisabled();
    });
  });

  // ── Error Handling (criterion 27) ─────────────────────────────────────────

  describe('Error Handling', () => {
    test('shows error message when addComment fails', async () => {
      const user = userEvent.setup();
      addComment.mockRejectedValue({
        response: { status: 500, data: { message: 'Server error occurred' } },
      });
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() =>
        expect(screen.getByText('Server error occurred')).toBeInTheDocument()
      );
    });

    test('shows permission error on 403 response', async () => {
      const user = userEvent.setup();
      addComment.mockRejectedValue({
        response: { status: 403, data: { message: 'Forbidden' } },
      });
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() =>
        expect(
          screen.getByText(/You do not have permission/i)
        ).toBeInTheDocument()
      );
    });

    test('onCommentAdded NOT called when API fails', async () => {
      const user = userEvent.setup();
      const onCommentAdded = jest.fn();
      addComment.mockRejectedValue({
        response: { status: 500, data: { message: 'Server error' } },
      });
      renderForm({ onCommentAdded });
      await user.type(screen.getByLabelText('Comment content'), 'Test');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());
      expect(onCommentAdded).not.toHaveBeenCalled();
    });
  });

  // ── Student / Non-Committee Role (criterion 28) ───────────────────────────

  describe('Student Role', () => {
    test('shows informational message for student role instead of form', () => {
      useAuthStore.mockImplementation((selector) => selector({ user: STUDENT_USER }));
      renderForm();
      expect(
        screen.getByText(/Only committee members and coordinators can add comments/i)
      ).toBeInTheDocument();
    });

    test('content textarea NOT rendered for student role', () => {
      useAuthStore.mockImplementation((selector) => selector({ user: STUDENT_USER }));
      renderForm();
      expect(screen.queryByLabelText('Comment content')).not.toBeInTheDocument();
    });

    test('submit button NOT rendered for student role', () => {
      useAuthStore.mockImplementation((selector) => selector({ user: STUDENT_USER }));
      renderForm();
      expect(
        screen.queryByRole('button', { name: 'Submit comment' })
      ).not.toBeInTheDocument();
    });
  });

  // ── Coordinator Role ──────────────────────────────────────────────────────

  describe('Coordinator Role', () => {
    test('coordinator sees the full form', () => {
      useAuthStore.mockImplementation((selector) => selector({ user: COORD_USER }));
      renderForm();
      expect(screen.getByLabelText('Comment content')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit comment' })).toBeInTheDocument();
    });
  });

  // ── Validation Edge Cases (coverage for defensive guards) ────────────────

  describe('Validation Edge Cases', () => {
    test('empty content via form submit shows content required error', () => {
      // The submit button is disabled when empty, but the form's onSubmit guard
      // still runs if the form is submitted programmatically (e.g. keyboard).
      const { container } = renderForm();
      fireEvent.submit(container.querySelector('form'));
      expect(screen.getByText('Comment content is required')).toBeInTheDocument();
      expect(addComment).not.toHaveBeenCalled();
    });

    test('content exceeding 5000 chars via form submit shows length error', async () => {
      // The textarea has maxLength=5000 so userEvent cannot type past it;
      // fireEvent.change bypasses the HTML attribute to reach the JS guard.
      const { container } = renderForm();
      const textarea = screen.getByLabelText('Comment content');
      fireEvent.change(textarea, { target: { value: 'a'.repeat(5001) } });
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() =>
        expect(screen.getByText(/Comment cannot exceed 5000 characters/i)).toBeInTheDocument()
      );
      expect(addComment).not.toHaveBeenCalled();
    });

    test('section number 0 shows positive integer error', async () => {
      const user = userEvent.setup();
      const { container } = renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Valid content');
      await user.type(screen.getByLabelText('Section number'), '0');
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() =>
        expect(
          screen.getByText('Section number must be a positive integer')
        ).toBeInTheDocument()
      );
      expect(addComment).not.toHaveBeenCalled();
    });
  });

  // ── Clear Button ──────────────────────────────────────────────────────────

  describe('Clear Button', () => {
    test('clear button resets content, type, section number, and error', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText('Comment content'), 'Some text');
      await user.type(screen.getByLabelText('Section number'), '2');
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Comment type/i }),
        'question'
      );

      await user.click(screen.getByRole('button', { name: 'Clear form' }));

      expect(screen.getByLabelText('Comment content')).toHaveValue('');
      expect(screen.getByLabelText('Section number')).toHaveValue(null);
      expect(screen.getByRole('combobox', { name: /Comment type/i })).toHaveValue('general');
    });

    test('clear button removes displayed error', async () => {
      const user = userEvent.setup();
      addComment.mockRejectedValue({
        response: { status: 500, data: { message: 'Server error' } },
      });
      renderForm();
      await user.type(screen.getByLabelText('Comment content'), 'Test');
      await user.click(screen.getByRole('button', { name: 'Submit comment' }));
      await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Clear form' }));
      expect(screen.queryByText('Server error')).not.toBeInTheDocument();
    });
  });
});
