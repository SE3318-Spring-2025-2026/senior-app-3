import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddMemberForm from '../components/AddMemberForm';
import * as groupService from '../api/groupService';

jest.mock('../api/groupService');

describe('Group Member Addition', () => {
  const mockGroupId = 'g1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders email input and submit button', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    const button = screen.getByRole('button', { name: /Send Invite/i });

    expect(input).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it('shows success message when member invited', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's2', email: 'student2@example.com' }],
      errors: [],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student2@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Invitation sent/i)).toBeInTheDocument();
    });
  });

  it('handles STUDENT_NOT_FOUND error', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [],
      errors: [{ code: 'STUDENT_NOT_FOUND' }],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'notfound@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/No student found/i)).toBeInTheDocument();
    });
  });

  it('handles ALREADY_INVITED error', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [],
      errors: [{ code: 'ALREADY_INVITED' }],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'invited@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/already been invited/i)).toBeInTheDocument();
    });
  });

  it('handles STUDENT_ALREADY_IN_GROUP error', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [],
      errors: [{ code: 'STUDENT_ALREADY_IN_GROUP' }],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'busy@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/already belongs to another group/i)).toBeInTheDocument();
    });
  });

  it('handles FORBIDDEN error for non-leaders', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockRejectedValue({
      response: { status: 403, data: { code: 'FORBIDDEN' } },
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Only the group leader/i)).toBeInTheDocument();
    });
  });

  it('trims whitespace from email input', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1' }],
      errors: [],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, '   student@example.com   ');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(groupService.addGroupMembers).toHaveBeenCalledWith(
        mockGroupId,
        ['student@example.com']
      );
    });
  });

  it('clears input after successful invitation', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1' }],
      errors: [],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('calls onMemberAdded callback on success', async () => {
    const user = userEvent.setup();
    const mockCallback = jest.fn();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1' }],
      errors: [],
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockCallback} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@example.com');
    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockCallback).toHaveBeenCalled();
    });
  });
});
