import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ProfessorInbox from '../components/ProfessorInbox';

jest.mock('../store/authStore');
jest.mock('../api/advisorService');

const useAuthStore = require('../store/authStore').default;
const { getMyAdvisorRequests, decideOnAdvisorRequest } = require('../api/advisorService');

describe('ProfessorInbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_prof_1', role: 'professor' } })
    );
  });

  it('renders pending advisor requests with approve and reject buttons', async () => {
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_1',
        groupId: 'grp_1',
        groupName: 'Team Apollo',
        requesterId: 'usr_leader_1',
        status: 'pending',
        message: 'Please advise our project.',
      },
    ]);

    render(<ProfessorInbox />);

    expect(screen.getByText(/Loading requests/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Advisor Requests')).toBeInTheDocument();
      expect(screen.getByText('Team Apollo')).toBeInTheDocument();
      expect(screen.getByText('pending')).toBeInTheDocument();
    });
  });

  it('approves a pending request with the correct payload', async () => {
    const user = userEvent.setup();
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_approve',
        groupId: 'grp_approve',
        groupName: 'Team Orion',
        requesterId: 'usr_leader_2',
        status: 'pending',
        message: 'We need your expertise.',
      },
    ]);
    decideOnAdvisorRequest.mockResolvedValue({ requestId: 'req_approve', assignedGroupId: 'grp_approve' });

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Orion')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Team Orion'));
    const requestCard = screen.getByText('Team Orion').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    await user.click(approveButton);

    await waitFor(() => {
      expect(decideOnAdvisorRequest).toHaveBeenCalledWith('req_approve', 'approve', null);
    });
  });

  it('rejects a pending request only after a reason is provided', async () => {
    const user = userEvent.setup();
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_reject',
        groupId: 'grp_reject',
        groupName: 'Team Phoenix',
        requesterId: 'usr_leader_3',
        status: 'pending',
        message: 'Please consider our request.',
      },
    ]);
    decideOnAdvisorRequest.mockResolvedValue({ requestId: 'req_reject', decision: 'reject' });

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Phoenix')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Team Phoenix'));
    const requestCard = screen.getByText('Team Phoenix').closest('.request-card');
    const textarea = within(requestCard).getByPlaceholderText(/Reason for rejection/i);
    await user.type(textarea, 'My capacity is limited.');
    const rejectButton = within(requestCard).getByRole('button', { name: /Reject/i });
    await user.click(rejectButton);

    await waitFor(() => {
      expect(decideOnAdvisorRequest).toHaveBeenCalledWith('req_reject', 'reject', 'My capacity is limited.');
    });
  });

  it('shows schedule closed error when decision endpoint returns 422', async () => {
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_closed',
        groupId: 'grp_closed',
        groupName: 'Team Atlas',
        requesterId: 'usr_leader_4',
        status: 'pending',
        message: 'Looking forward to your feedback.',
      },
    ]);
    decideOnAdvisorRequest.mockRejectedValue({ response: { status: 422 } });

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Atlas')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Team Atlas'));
    const requestCard = screen.getByText('Team Atlas').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.getByText(/Advisor association window is currently closed/i)).toBeInTheDocument();
    });
  });

  it('shows already processed error when server returns 409', async () => {
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_conflict',
        groupId: 'grp_conflict',
        groupName: 'Team Voyager',
        requesterId: 'usr_leader_5',
        status: 'pending',
        message: 'Please approve our request.',
      },
    ]);
    decideOnAdvisorRequest.mockRejectedValue({
      response: { status: 409, data: { details: { decision: 'approve' } } },
    });

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Voyager')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Team Voyager'));
    const requestCard = screen.getByText('Team Voyager').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.getByText(/Request already processed: approve/i)).toBeInTheDocument();
    });
  });

  it('renders an empty inbox placeholder when no requests exist', async () => {
    getMyAdvisorRequests.mockResolvedValue([]);

    render(<ProfessorInbox />);

    await waitFor(() => {
      expect(screen.getByText(/No .*requests/i)).toBeInTheDocument();
    });
  });
});
