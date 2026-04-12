import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import GroupCreationPage from '../components/GroupCreationPage';
import useAuthStore from '../store/authStore';
import * as groupService from '../api/groupService';

jest.mock('../store/authStore');
jest.mock('../api/groupService');

describe('GroupCreationPage', () => {
  const mockUser = { userId: 'leader1', email: 'leader@example.com', role: 'student' };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  const renderGroupCreation = () => {
    return render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
          <Route path="/groups/:group_id" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe('Group Creation Form', () => {
    it('renders group creation form with group name input', () => {
      renderGroupCreation();
      expect(screen.getByLabelText(/Group Name/i)).toBeInTheDocument();
    });

    it('submit button exists when group name is provided', async () => {
      const user = userEvent.setup();
      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Test Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      expect(createButton).toBeInTheDocument();
    });

    it('submits form with trimmed group name', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({ groupId: 'g1', groupName: 'Test Group' });

      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, '  Test Group  ');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ groupName: 'Test Group' })
        );
      });
    });

    it('shows error on duplicate group name', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockRejectedValue({
        response: { data: { code: 'GROUP_NAME_TAKEN' } },
      });

      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Existing Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(screen.getByText(/group with this name already exists/i)).toBeInTheDocument();
      });
    });

    it('shows error on schedule window closed', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockRejectedValue({
        response: { data: { code: 'OUTSIDE_SCHEDULE_WINDOW' } },
      });

      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'New Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(screen.getByText(/Group creation is currently closed/i)).toBeInTheDocument();
      });
    });

    it('shows error when student already in group', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockRejectedValue({
        response: { data: { code: 'STUDENT_ALREADY_IN_GROUP' } },
      });

      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Another Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(screen.getByText(/already belong to an active group/i)).toBeInTheDocument();
      });
    });

    it('clears validation error when user corrects input', async () => {
      const user = userEvent.setup();
      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);

      // Submit empty
      await user.type(input, '   ');
      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(screen.getByText(/Group name is required/i)).toBeInTheDocument();
      });

      // Correct the error
      await user.clear(input);
      await user.type(input, 'Valid Group');

      expect(screen.queryByText(/Group name is required/i)).not.toBeInTheDocument();
    });

    it('includes optional GitHub fields when provided', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({ groupId: 'g1' });

      renderGroupCreation();

      await user.type(screen.getByLabelText(/Group Name/i), 'Test Group');
      await user.type(screen.getByLabelText(/GitHub Organisation/i), 'my-org');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ githubOrg: 'my-org' })
        );
      });
    });

    it('shows loading state during submission', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockImplementation(() => new Promise(() => {}));

      renderGroupCreation();

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Test Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(createButton).toBeDisabled();
      });
    });

    it('navigates to group dashboard on success', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({
        groupId: 'new-group-id',
        groupName: 'Test Group',
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          <Routes>
            <Route path="/groups/new" element={<GroupCreationPage />} />
            <Route path="/groups/:group_id" element={<div>Dashboard Content</div>} />
          </Routes>
        </MemoryRouter>
      );

      const input = screen.getByLabelText(/Group Name/i);
      await user.type(input, 'Test Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalled();
      });
    });
  });

  describe('User Attribution', () => {
    it('uses authenticated user as group leader', async () => {
      const user = userEvent.setup();
      groupService.createGroup.mockResolvedValue({ groupId: 'g1' });

      renderGroupCreation();

      await user.type(screen.getByLabelText(/Group Name/i), 'Test Group');

      const buttons = screen.getAllByRole('button');
      const createButton = buttons.find(b => b.textContent.includes('Create'));
      await user.click(createButton);

      await waitFor(() => {
        expect(groupService.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ leaderId: mockUser.userId })
        );
      });
    });
  });
});
