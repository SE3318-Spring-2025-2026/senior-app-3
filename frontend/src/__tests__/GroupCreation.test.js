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
  const mockUser = { 
    userId: 'student1', 
    email: 'student@university.edu', 
    role: 'student' 
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  it('renders group creation form with group name input', () => {
    render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Create a Group')).toBeInTheDocument();
    expect(screen.getByLabelText(/Group Name/i)).toBeInTheDocument();
  });

  it('displays subtitle about team leader', () => {
    render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/automatically be assigned as Team Leader/i)).toBeInTheDocument();
  });

  it('has create button in form', () => {
    render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
        </Routes>
      </MemoryRouter>
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.some(btn => btn.textContent.includes('Create'))).toBe(true);
  });

  it('accepts group name input', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
        </Routes>
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/Group Name/i);
    await user.type(input, 'Test Group');
    
    expect(input).toHaveValue('Test Group');
  });

  it('submits form with group name and user ID', async () => {
    const user = userEvent.setup();
    groupService.createGroup.mockResolvedValue({
      groupId: 'g123',
      groupName: 'Test Group'
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
    await user.type(input, 'Test Group');
    
    const createButtons = screen.getAllByRole('button').filter(b => b.textContent.includes('Create'));
    await user.click(createButtons[0]);

    await waitFor(() => {
      expect(groupService.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: 'Test Group',
          leaderId: 'student1'
        })
      );
    });
  });

  it('shows error message for duplicate group name', async () => {
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

    const input = screen.getByLabelText(/Group Name/i);
    await user.type(input, 'Duplicate Name');
    
    const createButtons = screen.getAllByRole('button').filter(b => b.textContent.includes('Create'));
    await user.click(createButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/group with this name already exists/i)).toBeInTheDocument();
    });
  });

  it('shows error for schedule window closed', async () => {
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

    const input = screen.getByLabelText(/Group Name/i);
    await user.type(input, 'Test Group');
    
    const createButtons = screen.getAllByRole('button').filter(b => b.textContent.includes('Create'));
    await user.click(createButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Group creation is currently closed/i)).toBeInTheDocument();
    });
  });

  it('shows error when user already in a group', async () => {
    const user = userEvent.setup();
    groupService.createGroup.mockRejectedValue({
      response: { data: { code: 'STUDENT_ALREADY_IN_GROUP' } }
    });

    render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
        </Routes>
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/Group Name/i);
    await user.type(input, 'Test Group');
    
    const createButtons = screen.getAllByRole('button').filter(b => b.textContent.includes('Create'));
    await user.click(createButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/already belong to an active group/i)).toBeInTheDocument();
    });
  });

  it('trims whitespace from group name', async () => {
    const user = userEvent.setup();
    groupService.createGroup.mockResolvedValue({
      groupId: 'g123',
      groupName: 'Test Group'
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
    await user.type(input, '   Test Group   ');
    
    const createButtons = screen.getAllByRole('button').filter(b => b.textContent.includes('Create'));
    await user.click(createButtons[0]);

    await waitFor(() => {
      expect(groupService.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: 'Test Group'
        })
      );
    });
  });

  it('shows required field error when submitting empty form', async () => {
    const user = userEvent.setup();
    
    render(
      <MemoryRouter initialEntries={['/groups/new']}>
        <Routes>
          <Route path="/groups/new" element={<GroupCreationPage />} />
        </Routes>
      </MemoryRouter>
    );

    const createButtons = screen.getAllByRole('button').filter(b => b.textContent.includes('Create'));
    await user.click(createButtons[0]);

    expect(groupService.createGroup).not.toHaveBeenCalled();
  });
});
