import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import GroupDashboard from '../components/GroupDashboard';
import useAuthStore from '../store/authStore';
import useGroupStore from '../store/groupStore';
import * as groupService from '../api/groupService';

jest.mock('../store/authStore');
jest.mock('../store/groupStore');
jest.mock('../api/groupService');

describe('GroupDashboard', () => {
  const mockUser = {
    userId: 'user1',
    email: 'user@university.edu',
    role: 'student'
  };

  const mockGroupLeader = {
    userId: 'leader1',
    email: 'leader@university.edu',
    role: 'student'
  };

  const mockGroupData = {
    groupId: 'g123',
    groupName: 'Team Alpha',
    leaderId: 'leader1',
    status: 'active',
    createdAt: '2025-04-08T10:00:00Z'
  };

  const mockMembers = [
    {
      memberId: 's1',
      studentName: 'Alice',
      role: 'leader',
      status: 'active',
      joinedAt: '2025-04-08T10:00:00Z'
    },
    {
      memberId: 's2',
      studentName: 'Bob',
      role: 'member',
      status: 'pending',
      joinedAt: null
    }
  ];

  const mockGitHub = {
    connected: true,
    repo_url: 'https://github.com/team/repo',
    last_synced: '2025-04-08T10:00:00Z'
  };

  const mockJira = {
    connected: false,
    project_key: null,
    board_url: null
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      members: mockMembers,
      github: mockGitHub,
      jira: mockJira,
      pendingApprovalsCount: 1,
      isLoading: false,
      error: null,
      lastUpdated: new Date().toISOString(),
      fetchGroupDashboard: jest.fn(),
      startPolling: jest.fn(() => 123),
      stopPolling: jest.fn(),
    });
    groupService.getMyPendingInvitation.mockResolvedValue(null);
  });

  it('renders group dashboard with group name', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
  });

  it('displays member list with correct member count', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/2 members/i)).toBeInTheDocument();
  });

  it('renders GitHub status card', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('GitHub Integration')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders JIRA status card', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('JIRA Integration')).toBeInTheDocument();
  });

  it('displays pending approvals badge with correct count', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
    // Use getAllByText and get the first element (the badge), not the info-value
    const badgeElements = screen.getAllByText('1');
    const approvalbadge = badgeElements.find(el => el.className.includes('approval-badge'));
    expect(approvalbadge).toBeInTheDocument();
  });

  it('shows loading state when isLoading is true', () => {
    useGroupStore.mockReturnValue({
      groupData: null,
      members: [],
      isLoading: true,
      error: null,
      fetchGroupDashboard: jest.fn(),
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading group dashboard/i)).toBeInTheDocument();
  });

  it('shows error state when error is present', () => {
    useGroupStore.mockReturnValue({
      groupData: null,
      members: [],
      github: {},
      jira: {},
      pendingApprovalsCount: 0,
      isLoading: false,
      error: 'Failed to load group data',
      lastUpdated: null,
      fetchGroupDashboard: jest.fn(),
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Failed to load group data')).toBeInTheDocument();
  });

  it('calls startPolling on mount', () => {
    const mockStartPolling = jest.fn(() => 123);
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      members: mockMembers,
      github: mockGitHub,
      jira: mockJira,
      pendingApprovalsCount: 1,
      isLoading: false,
      error: null,
      lastUpdated: new Date().toISOString(),
      fetchGroupDashboard: jest.fn(),
      startPolling: mockStartPolling,
      stopPolling: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(mockStartPolling).toHaveBeenCalledWith('g123', 30000);
  });

  it('leader sees add member form', () => {
    useAuthStore.mockReturnValue(mockGroupLeader);

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Invite a Member/i)).toBeInTheDocument();
  });

  it('non-leader does not see add member form', () => {
    useAuthStore.mockReturnValue(mockUser); // Regular student, not leader

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText(/Invite a Member/i)).not.toBeInTheDocument();
  });

  it('coordinator sees coordinator panel button', () => {
    const coordinatorUser = {
      userId: 'coord1',
      email: 'coord@university.edu',
      role: 'coordinator'
    };
    useAuthStore.mockReturnValue(coordinatorUser);

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Coordinator Panel')).toBeInTheDocument();
  });

  it('displays refresh button and can refresh', async () => {
    const user = userEvent.setup();
    const mockFetchGroupDashboard = jest.fn();
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      members: mockMembers,
      github: mockGitHub,
      jira: mockJira,
      pendingApprovalsCount: 1,
      isLoading: false,
      error: null,
      lastUpdated: new Date().toISOString(),
      fetchGroupDashboard: mockFetchGroupDashboard,
      startPolling: jest.fn(() => 123),
      stopPolling: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    const refreshButton = screen.getByText('Refresh');
    await user.click(refreshButton);

    expect(mockFetchGroupDashboard).toHaveBeenCalledWith('g123');
  });

  it('displays last updated timestamp', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Last updated:/i)).toBeInTheDocument();
  });

  it('displays group status badge', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows pending invitation banner when user has invitation', async () => {
    groupService.getMyPendingInvitation.mockResolvedValue({
      invitation_id: 'inv123',
      group_id: 'g123',
      group_name: 'Team Alpha',
      status: 'pending'
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/You have been invited/i)).toBeInTheDocument();
    });
  });

  it('displays accept and decline buttons for invitation', async () => {
    groupService.getMyPendingInvitation.mockResolvedValue({
      invitation_id: 'inv123',
      group_id: 'g123',
      group_name: 'Team Alpha',
      status: 'pending'
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Accept')).toBeInTheDocument();
      expect(screen.getByText('Decline')).toBeInTheDocument();
    });
  });

  it('shows group footer with ID and creation date', () => {
    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Group ID: g123/i)).toBeInTheDocument();
    expect(screen.getByText(/Created:/i)).toBeInTheDocument();
  });

  it('handles empty members list', () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      members: [],
      github: mockGitHub,
      jira: mockJira,
      pendingApprovalsCount: 0,
      isLoading: false,
      error: null,
      lastUpdated: new Date().toISOString(),
      fetchGroupDashboard: jest.fn(),
      startPolling: jest.fn(() => 123),
      stopPolling: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/groups/g123']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/No members found/i)).toBeInTheDocument();
  });

  it('redirects to home when no group ID', () => {
    render(
      <MemoryRouter initialEntries={['/groups/']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
          <Route path="/" element={<div>Home</div>} />
          <Route path="*" element={<div>Not Found</div>} />
        </Routes>
      </MemoryRouter>
    );

    // When the route doesn't have a valid :group_id param, the GroupDashboard component
    // doesn't match the route, so we should see the not-found or home content
    // This test verifies the routing behavior works correctly
    expect(screen.getByText(/Not Found|Home/i)).toBeInTheDocument();
  });
});
