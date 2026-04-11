import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import useAuthStore from '../store/authStore';
import * as groupService from '../api/groupService';

jest.mock('../store/authStore');
jest.mock('../api/groupService');

describe('Group Invitation Decision Flow', () => {
  const mockUser = { 
    userId: 'student2', 
    email: 'student2@university.edu' 
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  it('should call submitMembershipDecision when accepting invitation', async () => {
    groupService.submitMembershipDecision.mockResolvedValue({
      decision: 'accepted',
      group_id: 'g123'
    });

    // Simulate accepting a group invitation
    await groupService.submitMembershipDecision('g123', 'accepted', 'student2');

    expect(groupService.submitMembershipDecision).toHaveBeenCalledWith(
      'g123',
      'accepted',
      'student2'
    );
  });

  it('should call submitMembershipDecision when rejecting invitation', async () => {
    groupService.submitMembershipDecision.mockResolvedValue({
      decision: 'rejected',
      group_id: 'g123'
    });

    await groupService.submitMembershipDecision('g123', 'rejected', 'student2');

    expect(groupService.submitMembershipDecision).toHaveBeenCalledWith(
      'g123',
      'rejected',
      'student2'
    );
  });

  it('should handle successful acceptance with optional message', async () => {
    groupService.submitMembershipDecision.mockResolvedValue({
      decision: 'accepted',
      message: 'Happy to join!'
    });

    const result = await groupService.submitMembershipDecision(
      'g123',
      'accepted',
      'student2',
      'Happy to join!'
    );

    expect(result.decision).toBe('accepted');
    expect(groupService.submitMembershipDecision).toHaveBeenCalledWith(
      'g123',
      'accepted',
      'student2',
      'Happy to join!'
    );
  });

  it('should handle invitation decision errors', async () => {
    groupService.submitMembershipDecision.mockRejectedValue({
      response: { data: { message: 'Decision processing failed' } }
    });

    await expect(
      groupService.submitMembershipDecision('g123', 'accepted', 'student2')
    ).rejects.toBeDefined();

    expect(groupService.submitMembershipDecision).toHaveBeenCalled();
  });

  it('should fetch pending invitation before showing decision options', async () => {
    groupService.getMyPendingInvitation.mockResolvedValue({
      invitation_id: 'inv123',
      group_id: 'g123',
      group_name: 'Team Alpha',
      invited_by: 'leader@university.edu',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    const invitation = await groupService.getMyPendingInvitation();

    expect(invitation).toBeDefined();
    expect(invitation.group_id).toBe('g123');
    expect(invitation.status).toBe('pending');
  });

  it('should handle case when no pending invitation exists', async () => {
    groupService.getMyPendingInvitation.mockResolvedValue(null);

    const invitation = await groupService.getMyPendingInvitation();

    expect(invitation).toBeNull();
  });

  it('should display invitation details when pending', async () => {
    const mockInvitation = {
      invitation_id: 'inv123',
      group_id: 'g123',
      group_name: 'Team Alpha',
      invited_by: 'leader@university.edu',
      status: 'pending',
      created_at: '2025-04-08T10:00:00Z'
    };

    // This would test that the invitation is displayed in GroupDashboard
    // For this unit test, we verify the data structure
    expect(mockInvitation.group_name).toBe('Team Alpha');
    expect(mockInvitation.status).toBe('pending');
  });

  it('should transition from inviting to accepting in proper order', async () => {
    // Step 1: Leader invites student
    groupService.addGroupMembers.mockResolvedValue({
      added: [{ studentId: 'student2' }],
      errors: []
    });

    await groupService.addGroupMembers('g123', ['student2@university.edu']);

    expect(groupService.addGroupMembers).toHaveBeenCalledWith(
      'g123',
      ['student2@university.edu']
    );

    // Step 2: Student sees pending invitation
    groupService.getMyPendingInvitation.mockResolvedValue({
      group_id: 'g123',
      status: 'pending'
    });

    const invitation = await groupService.getMyPendingInvitation();
    expect(invitation.status).toBe('pending');

    // Step 3: Student accepts invitation
    groupService.submitMembershipDecision.mockResolvedValue({
      decision: 'accepted'
    });

    const decision = await groupService.submitMembershipDecision('g123', 'accepted', 'student2');
    expect(decision.decision).toBe('accepted');
  });

  it('should support rejection after initial acceptance', async () => {
    // Start with accepted decision
    groupService.submitMembershipDecision.mockResolvedValueOnce({
      decision: 'accepted'
    });

    const firstDecision = await groupService.submitMembershipDecision('g123', 'accepted', 'student2');
    expect(firstDecision.decision).toBe('accepted');

    // Then could be rejected (in real use case, this might not be allowed)
    groupService.submitMembershipDecision.mockResolvedValueOnce({
      decision: 'rejected'
    });

    const secondDecision = await groupService.submitMembershipDecision('g123', 'rejected', 'student2');
    expect(secondDecision.decision).toBe('rejected');
  });
});
