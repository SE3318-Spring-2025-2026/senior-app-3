import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddMemberForm from '../components/AddMemberForm';
import * as groupService from '../api/groupService';

jest.mock('../api/groupService');

describe('AddMemberForm', () => {
  const mockGroupId = 'g123';
  const mockOnMemberAdded = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnMemberAdded.mockClear();
  });

  it('renders email input placeholder', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    expect(screen.getByPlaceholderText(/Student email/i)).toBeInTheDocument();
  });

  it('renders Send Invite button', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    expect(screen.getByRole('button', { name: /Send Invite/i })).toBeInTheDocument();
  });

  it('accepts email input', async () => {
    const user = userEvent.setup();
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    expect(input).toHaveValue('student@university.edu');
  });

  it('sends invitation and shows success message', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's123', email: 'student@university.edu' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Invitation sent/i)).toBeInTheDocument();
    });
  });

  it('calls callback after successful invitation', async () => {
    const user = userEvent.setup();
    const mockResult = {
      added: [{ studentId: 's123' }],
      errors: []
    };
    groupService.addGroupMembers.mockResolvedValue(mockResult);

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockOnMemberAdded).toHaveBeenCalledWith(mockResult);
    });
  });

  it('clears input after successful invitation', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's123' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('handles STUDENT_NOT_FOUND error', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [],
      errors: [{ code: 'STUDENT_NOT_FOUND' }]
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'notfound@university.edu');

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
      errors: [{ code: 'ALREADY_INVITED' }]
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'invited@university.edu');

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
      errors: [{ code: 'STUDENT_ALREADY_IN_GROUP' }]
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'busy@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/already belongs to another group/i)).toBeInTheDocument();
    });
  });

  it('handles FORBIDDEN error (non-leader)', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockRejectedValue({
      response: { status: 403, data: { code: 'FORBIDDEN' } }
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Only the group leader/i)).toBeInTheDocument();
    });
  });

  it('trims whitespace from email input', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's123' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, '   student@university.edu   ');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(groupService.addGroupMembers).toHaveBeenCalledWith(
        mockGroupId,
        ['student@university.edu']
      );
    });
  });

  it('disables button while loading', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockImplementation(() => 
      new Promise(() => {}) // Never resolves
    );

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
  });

  it('clears error message when typing', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [],
      errors: [{ code: 'STUDENT_NOT_FOUND' }]
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'notfound@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/No student found/i)).toBeInTheDocument();
    });

    // Clear input and type new email
    await user.clear(input);
    await user.type(input, 'new');

    expect(screen.queryByText(/No student found/i)).not.toBeInTheDocument();
  });

  it('disables button when input is empty', async () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const button = screen.getByRole('button', { name: /Send Invite/i });
    expect(button).toBeDisabled();
  });

  it('shows Sending text while loading', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockImplementation(() => 
      new Promise(() => {}) // Never resolves
    );

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Sending/i)).toBeInTheDocument();
    });
  });
});
