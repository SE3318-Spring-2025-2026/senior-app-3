import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import GroupCreationPage from '../components/GroupCreationPage';
import AddMemberForm from '../components/AddMemberForm';
import useAuthStore from '../store/authStore';
import * as groupService from '../api/groupService';

jest.mock('../store/authStore');
jest.mock('../api/groupService');

describe('Group Formation E2E Flows', () => {
  const mockUser = { userId: 'leader1', email: 'leader@example.com', role: 'student' };
  const mockGroupId = 'g1';

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  describe('Happy Path: Group Creation', () => {
    it('create group with name', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({
        groupId: mockGroupId,
        groupName: 'Alpha Team',
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route path="/groups/:group_id" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Alpha Team');
      const submitButton = screen.getByRole('button', { name: /create/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ groupName: 'Alpha Team' })
        );
      });
    });
  });

  describe('Happy Path: Add Member', () => {
    it('add member to group', async () => {
      const user = userEvent.setup();
      const mockOnMemberAdded = jest.fn();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's1', email: 'student@example.com' }],
        errors: [],
      });

      render(
        <AddMemberForm groupId={mockGroupId} onMemberAdded={mockOnMemberAdded} />
      );

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');
      const submitButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Invitation sent/i)).toBeInTheDocument();
      });

      expect(mockOnMemberAdded).toHaveBeenCalled();
    });
  });

  describe('Error: Duplicate Group Name', () => {
    it('shows error for duplicate group name', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockRejectedValue({
        response: { data: { code: 'GROUP_NAME_TAKEN' } },
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <GroupCreationPage />
        </MemoryRouter>
      );

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Duplicate Name');
      const submitButton = screen.getByRole('button', { name: /create/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/group with this name already exists/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Error: Invalid Student', () => {
    it('shows error for invalid student email', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_NOT_FOUND' }],
      });

      render(
        <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
      );

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'notastu@example.com');
      const submitButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/No student found/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error: Forbidden', () => {
    it('shows error when non-leader adds member', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockRejectedValue({
        response: { status: 403, data: { code: 'FORBIDDEN' } },
      });

      render(
        <AddMemberForm groupId={mockGroupId} onMemberAdded={jest.fn()} />
      );

      const input = screen.getByPlaceholderText(/Student email/i);
      await user.type(input, 'student@example.com');
      const submitButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Only the group leader can add members/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Form Validation', () => {
    it('trims whitespace from group name input', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({ groupId: mockGroupId });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route path="/groups/:group_id" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, '   Alpha Team   ');
      const submitButton = screen.getByRole('button', { name: /create/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ groupName: 'Alpha Team' })
        );
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
      const submitButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalledWith(
          mockGroupId,
          ['student@example.com']
        );
      });
    });
  });

  describe('Student Already in Group', () => {
    it('shows error when student already in group', async () => {
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
      const submitButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/already belongs to another group/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Already Invited', () => {
    it('shows error when already invited', async () => {
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
      const submitButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/already been invited/i)).toBeInTheDocument();
      });
    });
  });
});
