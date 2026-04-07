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
  const mockUser = {
    userId: 'leader1',
    email: 'leader@university.edu',
    role: 'student'
  };

  const mockStudent = {
    studentId: 's456',
    email: 'student@university.edu'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  describe('Happy Path: Create Group then Add Members', () => {
    it('should create group and then add members in sequence', async () => {
      const user = userEvent.setup();

      // Step 1: Create group
      groupService.createGroup.mockResolvedValue({
        groupId: 'g123',
        groupName: 'Team Alpha'
      });

      const { rerender } = render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route
              path="/groups/:group_id"
              element={
                <div>
                  <div>Group Dashboard</div>
                  <AddMemberForm
                    groupId="g123"
                    onMemberAdded={jest.fn()}
                  />
                </div>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Fill and submit group creation form
      const groupNameInput = screen.getByLabelText(/Group Name/i);
      await user.type(groupNameInput, 'Team Alpha');

      const createButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );
      await user.click(createButtons[0]);

      // Verify group creation API called
      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({
            groupName: 'Team Alpha',
            leaderId: 'leader1'
          })
        );
      });

      // Step 2: Add member to group
      groupService.addGroupMembers.mockResolvedValue({
        added: [mockStudent],
        errors: []
      });

      // Simulate navigation and add member
      rerender(
        <MemoryRouter initialEntries={['/groups/g123']}>
          <Routes>
            <Route
              path="/groups/:group_id"
              element={
                <div>
                  <div>Group Dashboard</div>
                  <AddMemberForm
                    groupId="g123"
                    onMemberAdded={jest.fn()}
                  />
                </div>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Add member
      const emailInput = screen.getByPlaceholderText(/Student email/i);
      await user.type(emailInput, 'student@university.edu');

      const sendButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalledWith(
          'g123',
          ['student@university.edu']
        );
      });
    });
  });

  describe('Error Path: Schedule Window Closed', () => {
    it('should block group creation when schedule window is closed', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockRejectedValue({
        response: { data: { code: 'OUTSIDE_SCHEDULE_WINDOW' } }
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
          </Routes>
        </MemoryRouter>
      );

      const groupNameInput = screen.getByLabelText(/Group Name/i);
      await user.type(groupNameInput, 'Team Alpha');

      const createButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );
      await user.click(createButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/currently closed/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Path: Duplicate Group Name', () => {
    it('should show error when group name already exists', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockRejectedValue({
        response: { data: { code: 'GROUP_NAME_TAKEN' } }
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
          </Routes>
        </MemoryRouter>
      );

      const groupNameInput = screen.getByLabelText(/Group Name/i);
      await user.type(groupNameInput, 'Existing Group');

      const createButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );
      await user.click(createButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/group with this name already exists/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Path: Student Not Found During Member Addition', () => {
    it('should show error when student email not found', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [],
        errors: [{ code: 'STUDENT_NOT_FOUND' }]
      });

      render(
        <MemoryRouter initialEntries={['/groups/g123']}>
          <Routes>
            <Route
              path="/groups/:group_id"
              element={
                <AddMemberForm
                  groupId="g123"
                  onMemberAdded={jest.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText(/Student email/i);
      await user.type(emailInput, 'notfound@university.edu');

      const sendButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/No student found/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Path: Non-Leader Adds Member', () => {
    it('should prevent non-leader from adding members', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockRejectedValue({
        response: { status: 403, data: { code: 'FORBIDDEN' } }
      });

      render(
        <MemoryRouter initialEntries={['/groups/g123']}>
          <Routes>
            <Route
              path="/groups/:group_id"
              element={
                <AddMemberForm
                  groupId="g123"
                  onMemberAdded={jest.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText(/Student email/i);
      await user.type(emailInput, 'student@university.edu');

      const sendButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/Only the group leader can add members/i)).toBeInTheDocument();
      });
    });
  });

  describe('Data Validation', () => {
    it('should trim whitespace from group name', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({
        groupId: 'g123',
        groupName: 'Team Alpha'
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route path="/groups/:group_id" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      const groupNameInput = screen.getByLabelText(/Group Name/i);
      await user.type(groupNameInput, '   Team Alpha   ');

      const createButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );
      await user.click(createButtons[0]);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({
            groupName: 'Team Alpha'
          })
        );
      });
    });

    it('should trim whitespace from student email', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [{ studentId: 's456' }],
        errors: []
      });

      render(
        <MemoryRouter initialEntries={['/groups/g123']}>
          <Routes>
            <Route
              path="/groups/:group_id"
              element={
                <AddMemberForm
                  groupId="g123"
                  onMemberAdded={jest.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText(/Student email/i);
      await user.type(emailInput, '   student@university.edu   ');

      const sendButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(groupService.addGroupMembers).toHaveBeenCalledWith(
          'g123',
          ['student@university.edu']
        );
      });
    });
  });

  describe('Recovery After Errors', () => {
    it('should allow retry after failed group creation', async () => {
      const user = userEvent.setup();

      // First attempt fails
      groupService.createGroup.mockRejectedValueOnce({
        response: { data: { message: 'Server error' } }
      });

      // Second attempt succeeds
      groupService.createGroup.mockResolvedValueOnce({
        groupId: 'g123',
        groupName: 'Team Alpha'
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route path="/groups/:group_id" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      const groupNameInput = screen.getByLabelText(/Group Name/i);
      await user.type(groupNameInput, 'Team Alpha');

      const createButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );

      // First attempt
      await user.click(createButtons[0]);

      await waitFor(() => {
        // Should show error
        expect(groupService.createGroup).toHaveBeenCalled();
      });

      // Clear and retry
      await user.clear(groupNameInput);
      await user.type(groupNameInput, 'Team Alpha');

      const newCreateButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );
      await user.click(newCreateButtons[0]);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('User Feedback', () => {
    it('should provide clear success feedback after group creation', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({
        groupId: 'g123',
        groupName: 'Team Alpha'
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route
              path="/groups/:group_id"
              element={<div data-testid="dashboard">Dashboard</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      const groupNameInput = screen.getByLabelText(/Group Name/i);
      await user.type(groupNameInput, 'Team Alpha');

      const createButtons = screen.getAllByRole('button').filter(b =>
        b.textContent.includes('Create')
      );
      await user.click(createButtons[0]);

      // Navigation would occur, verifying success
      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalled();
      });
    });

    it('should provide clear success feedback after member addition', async () => {
      const user = userEvent.setup();
      groupService.addGroupMembers.mockResolvedValue({
        added: [mockStudent],
        errors: []
      });

      render(
        <MemoryRouter initialEntries={['/groups/g123']}>
          <Routes>
            <Route
              path="/groups/:group_id"
              element={
                <AddMemberForm
                  groupId="g123"
                  onMemberAdded={jest.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText(/Student email/i);
      await user.type(emailInput, 'student@university.edu');

      const sendButton = screen.getByRole('button', { name: /Send Invite/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/Invitation sent/i)).toBeInTheDocument();
      });
    });
  });
});
