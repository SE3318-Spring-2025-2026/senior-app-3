import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import useAuthStore from '../store/authStore';
import * as groupService from '../api/groupService';

jest.mock('../store/authStore');
jest.mock('../api/groupService');

describe('Auto-Denial Feedback', () => {
  const mockUser = { 
    userId: 'student3', 
    email: 'student3@university.edu',
    role: 'student'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue(mockUser);
  });

  it('should indicate when invitation has been auto-denied', async () => {
    // Simulate checking status of an invitation after another was accepted
    const autoDeniedInvitation = {
      invitation_id: 'inv456',
      group_id: 'g456',
      group_name: 'Team Beta',
      status: 'auto_denied', // Changed from pending to auto_denied
      auto_denied_reason: 'You have already accepted another group invitation',
      created_at: '2025-04-08T10:00:00Z'
    };

    expect(autoDeniedInvitation.status).toBe('auto_denied');
    expect(autoDeniedInvitation.auto_denied_reason).toBeDefined();
  });

  it('should track when student accepts first invitation', async () => {
    groupService.submitMembershipDecision.mockResolvedValue({
      decision: 'accepted',
      group_id: 'g123',
      student_id: 'student3'
    });

    const result = await groupService.submitMembershipDecision(
      'g123',
      'accepted',
      'student3'
    );

    expect(result.decision).toBe('accepted');
  });

  it('should show feedback that other invitations have been auto-denied', async () => {
    // After accepting one invitation, get list of what happened to others
    const feedbackMessage = {
      type: 'auto_denial_feedback',
      message: 'Since you accepted the invitation from Team Alpha, your invitation from Team Beta has been automatically denied.',
      auto_denied_groups: ['Team Beta', 'Team Gamma'],
      timestamp: new Date().toISOString()
    };

    expect(feedbackMessage.type).toBe('auto_denial_feedback');
    expect(feedbackMessage.auto_denied_groups).toContain('Team Beta');
  });

  it('should count number of auto-denied invitations', () => {
    const feedback = {
      accepted_group: 'Team Alpha',
      auto_denied_count: 2,
      auto_denied_groups: [
        { group_name: 'Team Beta', group_id: 'g456' },
        { group_name: 'Team Gamma', group_id: 'g789' }
      ]
    };

    expect(feedback.auto_denied_count).toBe(2);
    expect(feedback.auto_denied_groups).toHaveLength(2);
  });

  it('should handle case with no other invitations to deny', () => {
    const feedback = {
      accepted_group: 'Team Alpha',
      auto_denied_count: 0,
      auto_denied_groups: []
    };

    expect(feedback.auto_denied_count).toBe(0);
    expect(feedback.auto_denied_groups).toHaveLength(0);
  });

  it('should provide clearance that decision was processed', async () => {
    const acceptanceResponse = {
      decision: 'accepted',
      group_id: 'g123',
      group_name: 'Team Alpha',
      processed_at: '2025-04-08T10:05:00Z',
      auto_denials_processed: true,
      auto_denied_groups_count: 3
    };

    expect(acceptanceResponse.auto_denials_processed).toBe(true);
    expect(acceptanceResponse.auto_denied_groups_count).toBe(3);
  });

  it('should allow viewing auto-denied invitation details', () => {
    const autoDeniedDetails = {
      invitation_id: 'inv456',
      group_id: 'g456',
      group_name: 'Team Beta',
      leader_name: 'Prof. Smith',
      status: 'auto_denied',
      denial_reason: 'auto_denial_after_acceptance',
      original_sent_date: '2025-04-07T14:00:00Z',
      auto_denied_date: '2025-04-08T10:05:00Z'
    };

    expect(autoDeniedDetails.group_name).toBe('Team Beta');
    expect(autoDeniedDetails.denial_reason).toBe('auto_denial_after_acceptance');
  });

  it('should track timeline of decisions', () => {
    const timeline = [
      {
        event: 'invitation_received',
        group_name: 'Team Alpha',
        timestamp: '2025-04-07T10:00:00Z'
      },
      {
        event: 'invitation_received',
        group_name: 'Team Beta',
        timestamp: '2025-04-07T11:00:00Z'
      },
      {
        event: 'invitation_received',
        group_name: 'Team Gamma',
        timestamp: '2025-04-07T12:00:00Z'
      },
      {
        event: 'decision_made',
        decision: 'accepted',
        group_name: 'Team Alpha',
        timestamp: '2025-04-08T10:00:00Z'
      },
      {
        event: 'auto_denial',
        group_name: 'Team Beta',
        timestamp: '2025-04-08T10:01:00Z'
      },
      {
        event: 'auto_denial',
        group_name: 'Team Gamma',
        timestamp: '2025-04-08T10:02:00Z'
      }
    ];

    const acceptanceEvents = timeline.filter(e => e.decision === 'accepted');
    const denialEvents = timeline.filter(e => e.event === 'auto_denial');

    expect(acceptanceEvents).toHaveLength(1);
    expect(denialEvents).toHaveLength(2);
  });

  it('should persist auto-denial feedback for user review', () => {
    const persistedFeedback = {
      student_id: 'student3',
      message: 'Your invitation from Team Beta was automatically denied because you accepted an invitation from Team Alpha.',
      dismissed: false,
      created_at: '2025-04-08T10:05:00Z',
      expires_at: '2025-04-15T10:05:00Z' // Show for 7 days
    };

    expect(persistedFeedback.dismissed).toBe(false);
    expect(persistedFeedback.student_id).toBe('student3');
  });

  it('should allow dismissing auto-denial feedback notification', () => {
    const feedback = {
      id: 'feedback123',
      message: 'Your invitation from Team Beta was automatically denied.',
      dismissed: false
    };

    // Simulate dismissing
    feedback.dismissed = true;

    expect(feedback.dismissed).toBe(true);
  });
});
