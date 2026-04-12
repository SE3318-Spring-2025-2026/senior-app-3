import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddMemberForm from '../components/AddMemberForm';
import * as groupService from '../api/groupService';

jest.mock('../api/groupService');

describe('AddMemberForm', () => {
  const mockGroupId = 'g1';
  const mockOnMemberAdded = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderAddMemberForm = () => {
    return render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );
  };

  describe('Form Rendering', () => {
    it('renders input and Send Invite button', () => {
      renderAddMemberForm();

      expect(screen.getByPlaceholderText(/Student email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send Invite/i })).toBeInTheDocument();
    });

    it('input has correct placeholder text', () => {
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      expect(input).toHaveAttribute('placeholder', expect.stringMatching(/charlie@university.edu/));
    });

    it('initializes with empty input value', () => {
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      expect(input).toHaveValue('');
    });
  });

  describe('Button State', () => {
    it('button disabled when input is empty', () => {
      renderAddMemberForm();

      const button = screen.getByRole('button', { name: /Send Invite/i });
      expect(button).toBeDisabled();
    });

    it('button enabled when input has content', async () => {
      const user = userEvent.setup();
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');

      const button = screen.getByRole('button', { name: /Send Invite/i });
      expect(button).not.toBeDisabled();
    });

    it('button disabled while loading', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');

      const button = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
      });
    });

    it('button shows sending state text while loading', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');

      const button = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sending/i })).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('does not submit when input is empty', async () => {
      const user = userEvent.setup();
      renderAddMemberForm();

      const form = screen.getByPlaceholderText(/Student email/i).closest('form');
      await user.click(form);

      expect(groupService.addGroupMembers).not.toHaveBeenCalled();
    });

    it('calls addGroupMembers with trimmed input on submit', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1', email: 'student@example.com' }],
        errors: [],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, '  student@example.com  ');

      const button = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(button);

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalledWith(
          mockGroupId,
          ['student@example.com']
        );
      });
    });

    it('trims whitespace before submission', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1' }],
        errors: [],
      });
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), '   test@example.com   ');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalledWith(
          mockGroupId,
          ['test@example.com']
        );
      });
    });

    it('submits on Enter key', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1' }],
        errors: [],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalled();
      });
    });
  });

  describe('Success Handling', () => {
    it('shows success message when member added', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1' }],
        errors: [],
      });
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/Invitation sent to student@example.com/i)).toBeInTheDocument();
      });
    });

    it('clears input after successful submission', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1' }],
        errors: [],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(input).toHaveValue('');
      });
    });

    it('calls onMemberAdded callback with result on success', async () => {
      const user = userEvent.setup();
      const mockResult = {
        added: [{ studentId: 's1', email: 'student@example.com' }],
        errors: [],
      };
      groupService.addGroupMembers.mockResolvedValue(mockResult);
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(mockOnMemberAdded).toHaveBeenCalledWith(mockResult);
      });
    });
  });

  describe('Error Handling', () => {
    it('shows STUDENT_NOT_FOUND error message', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_NOT_FOUND', message: 'Not found' }],
      });
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'notfound@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/No student found/i)).toBeInTheDocument();
      });
    });

    it('shows ALREADY_INVITED error message', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'ALREADY_INVITED', message: 'Already invited' }],
      });
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/already been invited/i)).toBeInTheDocument();
      });
    });

    it('shows STUDENT_ALREADY_IN_GROUP error message', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_ALREADY_IN_GROUP', message: 'Already in group' }],
      });
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/already belongs to another group/i)).toBeInTheDocument();
      });
    });

    it('shows FORBIDDEN error for non-leaders', async () => {
      const user = userEvent.setup();
      const error = {
        response: { data: { code: 'FORBIDDEN' } },
      };
      groupService.addGroupMembers.mockRejectedValue(error);
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/Only the group leader can add members/i)).toBeInTheDocument();
      });
    });

    it('shows fallback error message on unexpected error', async () => {
      const user = userEvent.setup();
      const error = {
        response: { data: { message: 'Something went wrong' } },
      };
      groupService.addGroupMembers.mockRejectedValue(error);
      renderAddMemberForm();

      await user.type(screen.getByPlaceholderText(/Student email/i), 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
      });
    });

    it('applies error styling to input when error exists', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_NOT_FOUND' }],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(input).toHaveClass('input-error');
      });
    });
  });

  describe('Input Behavior', () => {
    it('clears success message when typing in input', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1' }],
        errors: [],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/Invitation sent/i)).toBeInTheDocument();
      });

      await user.type(input, 'x');
      expect(screen.queryByText(/Invitation sent/i)).not.toBeInTheDocument();
    });

    it('clears error message when typing in input', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_NOT_FOUND' }],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'notfound@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(screen.getByText(/No student found/i)).toBeInTheDocument();
      });

      await user.type(input, 'x');
      expect(screen.queryByText(/No student found/i)).not.toBeInTheDocument();
    });

    it('removes error styling when typing after error', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_NOT_FOUND' }],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'notfound@example.com');
      await user.click(screen.getByRole('button', { name: /Send Invite/i }));

      await waitFor(() => {
        expect(input).toHaveClass('input-error');
      });

      await user.type(input, 'x');
      expect(input).not.toHaveClass('input-error');
    });
  });

  describe('Multiple Submissions', () => {
    it('allows multiple invitations in succession', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1' }],
        errors: [],
      });
      renderAddMemberForm();

      const input = screen.getByPlaceholderText(/Student email/i);
      const button = screen.getByRole('button', { name: /Send Invite/i });

      // First invitation
      await user.type(input, 'first@example.com');
      await user.click(button);

      await waitFor(() => {
        expect(input).toHaveValue('');
      });

      // Second invitation
      await user.type(input, 'second@example.com');
      await user.click(button);

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalledTimes(2);
      });
    });
  });
});
