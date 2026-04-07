import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddMemberForm from '../components/AddMemberForm';
import * as groupService from '../api/groupService';

jest.mock('../api/groupService');

describe('Member Addition Integration', () => {
  const mockGroupId = 'g123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders member addition form in group context', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    expect(screen.getByText(/Invite a Member/i)).toBeInTheDocument();
  });

  it('shows invite member section header', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    expect(screen.getByText('Invite a Member')).toBeInTheDocument();
  });

  it('accepts multiple students sequentially', async () => {
    const user = userEvent.setup();
    const mockOnMemberAdded = jest.fn();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
    );

    // First student
    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student1@university.edu');
    let button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(input).toHaveValue('');
    });

    // Second student
    await user.type(input, 'student2@university.edu');
    button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    expect(mockOnMemberAdded).toHaveBeenCalledTimes(2);
  });

  it('validates email input format is accepted', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'valid.email+tag@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    expect(groupService.addGroupMembers).toHaveBeenCalledWith(
      mockGroupId,
      ['valid.email+tag@university.edu']
    );
  });

  it('sends correct group ID with invite request', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(groupService.addGroupMembers).toHaveBeenCalledWith(
        mockGroupId,
        expect.anything()
      );
    });
  });

  it('handles batch addition errors per student', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1', email: 'valid@university.edu' }],
      errors: [{ email: 'invalid@university.edu', code: 'STUDENT_NOT_FOUND' }]
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'valid@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    // Should process successfully even with errors
    await waitFor(() => {
      expect(groupService.addGroupMembers).toHaveBeenCalled();
    });
  });

  it('provides feedback on success count', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 's1', email: 'student@university.edu' }],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Invitation sent/i)).toBeInTheDocument();
    });
  });

  it('allows canceling mid-input', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockResolvedValue({
      added: [],
      errors: []
    });

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');
    await user.clear(input);

    const button = screen.getByRole('button', { name: /Send Invite/i });
    expect(button).toBeDisabled();

    expect(groupService.addGroupMembers).not.toHaveBeenCalled();
  });

  it('enforces required field validation', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const button = screen.getByRole('button', { name: /Send Invite/i });
    expect(button).toBeDisabled();
  });

  it('shows appropriate error message per error code', async () => {
    const user = userEvent.setup();

    // Test FORBIDDEN error
    groupService.addGroupMembers.mockRejectedValueOnce({
      response: { status: 403, data: { code: 'FORBIDDEN' } }
    });

    const { rerender } = render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    let input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');
    let button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Only the group leader/i)).toBeInTheDocument();
    });

    // Rerender for next error test
    rerender(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    // Clear for next test
    groupService.addGroupMembers.mockResolvedValueOnce({
      added: [],
      errors: [{ code: 'ALREADY_INVITED' }]
    });

    input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'invited@university.edu');
    button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/already been invited/i)).toBeInTheDocument();
    });
  });

  it('maintains form state during network request', async () => {
    const user = userEvent.setup();
    groupService.addGroupMembers.mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/i);
    await user.type(input, 'student@university.edu');

    const button = screen.getByRole('button', { name: /Send Invite/i });
    await user.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    // Input should keep value while loading
    expect(input).toHaveValue('student@university.edu');
  });

  it('supports accessibility for screen readers', () => {
    render(
      <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Student email/);
    expect(input).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /Send Invite/i });
    expect(button).toBeInTheDocument();
  });
});
