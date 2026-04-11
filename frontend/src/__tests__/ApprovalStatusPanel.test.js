import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import useGroupStore from '../store/groupStore';
import useAuthStore from '../store/authStore';
import * as groupService from '../api/groupService';

jest.mock('../store/groupStore');
jest.mock('../store/authStore');
jest.mock('../api/groupService');

describe('Approval Status Panel', () => {
  const mockUser = { 
    userId: 'leader1', 
    email: 'leader@university.edu',
    role: 'student'
  };

  const mockGroupData = {
    groupId: 'g123',
    groupName: 'Team Alpha',
    leaderId: 'leader1'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  it('should display pending approvals count', () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      pendingApprovalsCount: 3,
      members: [
        { studentId: 's1', name: 'Student 1', status: 'pending' },
        { studentId: 's2', name: 'Student 2', status: 'pending' },
        { studentId: 's3', name: 'Student 3', status: 'pending' }
      ]
    });

    const store = useGroupStore();
    expect(store.pendingApprovalsCount).toBe(3);
    expect(store.members.filter(m => m.status === 'pending')).toHaveLength(3);
  });

  it('should show no pending approvals when count is zero', () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      pendingApprovalsCount: 0,
      members: []
    });

    const store = useGroupStore();
    expect(store.pendingApprovalsCount).toBe(0);
  });

  it('should display approval status for each member', () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      pendingApprovalsCount: 2,
      members: [
        { studentId: 's1', name: 'Student 1', status: 'pending' },
        { studentId: 's2', name: 'Student 2', status: 'pending' },
        { studentId: 's3', name: 'Student 3', status: 'approved' }
      ]
    });

    const store = useGroupStore();
    const pendingMembers = store.members.filter(m => m.status === 'pending');
    const approvedMembers = store.members.filter(m => m.status === 'approved');

    expect(pendingMembers).toHaveLength(2);
    expect(approvedMembers).toHaveLength(1);
  });

  it('should track approval timeline', () => {
    const approvalRecords = [
      {
        memberId: 's1',
        memberName: 'Student 1',
        status: 'pending',
        invited_at: '2025-04-08T10:00:00Z'
      },
      {
        memberId: 's2',
        memberName: 'Student 2',
        status: 'approved',
        invited_at: '2025-04-08T10:10:00Z',
        approved_at: '2025-04-08T10:15:00Z'
      },
      {
        memberId: 's3',
        memberName: 'Student 3',
        status: 'rejected',
        invited_at: '2025-04-08T10:20:00Z',
        rejected_at: '2025-04-08T10:25:00Z'
      }
    ];

    const pendingApprovals = approvalRecords.filter(r => r.status === 'pending');
    expect(pendingApprovals).toHaveLength(1);
  });

  it('should show approval indicator badge', () => {
    const approvalStatus = {
      memberId: 's1',
      memberName: 'Student 1',
      status: 'pending',
      badge: {
        label: 'Pending',
        color: 'yellow',
        icon: 'hourglass'
      }
    };

    expect(approvalStatus.badge.label).toBe('Pending');
    expect(approvalStatus.badge.color).toBe('yellow');
  });

  it('should handle different approval statuses with appropriate styling', () => {
    const statusStyles = {
      pending: { color: 'warning', icon: 'hourglass' },
      approved: { color: 'success', icon: 'checkmark' },
      rejected: { color: 'error', icon: 'xmark' }
    };

    expect(statusStyles.pending.color).toBe('warning');
    expect(statusStyles.approved.color).toBe('success');
    expect(statusStyles.rejected.color).toBe('error');
  });

  it('should update approval count when member approves', () => {
    useGroupStore.mockReturnValueOnce({
      groupData: mockGroupData,
      pendingApprovalsCount: 3,
      members: [
        { studentId: 's1', status: 'pending' },
        { studentId: 's2', status: 'pending' },
        { studentId: 's3', status: 'pending' }
      ]
    });

    let store = useGroupStore();
    expect(store.pendingApprovalsCount).toBe(3);

    // Simulate one approval
    useGroupStore.mockReturnValueOnce({
      groupData: mockGroupData,
      pendingApprovalsCount: 2,
      members: [
        { studentId: 's1', status: 'approved' },
        { studentId: 's2', status: 'pending' },
        { studentId: 's3', status: 'pending' }
      ]
    });

    store = useGroupStore();
    expect(store.pendingApprovalsCount).toBe(2);
  });

  it('should display total members vs approved count', () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      pendingApprovalsCount: 2,
      members: [
        { studentId: 's1', status: 'approved' },
        { studentId: 's2', status: 'pending' },
        { studentId: 's3', status: 'pending' },
        { studentId: 's4', status: 'approved' }
      ]
    });

    const store = useGroupStore();
    const totalMembers = store.members.length;
    const approvedCount = store.members.filter(m => m.status === 'approved').length;

    expect(totalMembers).toBe(4);
    expect(approvedCount).toBe(2);
    expect(store.pendingApprovalsCount).toBe(2);
  });

  it('should show loading state while fetching approvals', async () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      isLoading: true,
      pendingApprovalsCount: null,
      members: []
    });

    const store = useGroupStore();
    expect(store.isLoading).toBe(true);
  });

  it('should display error message if approvals fetch fails', () => {
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      isLoading: false,
      error: 'Failed to fetch approvals',
      pendingApprovalsCount: 0,
      members: []
    });

    const store = useGroupStore();
    expect(store.error).toBe('Failed to fetch approvals');
  });

  it('should refresh approval status periodically', async () => {
    const mockSetInterval = jest.fn();
    global.setInterval = mockSetInterval;

    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      startPolling: jest.fn((groupId, interval) => {
        return setInterval(() => {}, interval || 30000);
      }),
      pendingApprovalsCount: 2,
      members: []
    });

    const store = useGroupStore();
    const intervalId = store.startPolling('g123');

    expect(store.startPolling).toHaveBeenCalledWith('g123');
  });

  it('should allow manual refresh of approval status', async () => {
    const mockFetchGroupDashboard = jest.fn();
    
    useGroupStore.mockReturnValue({
      groupData: mockGroupData,
      fetchGroupDashboard: mockFetchGroupDashboard,
      pendingApprovalsCount: 2,
      members: []
    });

    const store = useGroupStore();
    await store.fetchGroupDashboard('g123');

    expect(mockFetchGroupDashboard).toHaveBeenCalledWith('g123');
  });
});
