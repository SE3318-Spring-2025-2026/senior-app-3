import React from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ProfessorInbox from '../components/ProfessorInbox';

jest.mock('../store/authStore');

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: {
    patch: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    get: jest.fn(() => Promise.resolve({ data: {} })),
  },
}));

jest.mock('../api/advisorService', () => ({
  ...jest.requireActual('../api/advisorService'),
  getMyAdvisorRequests: jest.fn(),
  checkAdvisorWindow: jest.fn(),
}));

const useAuthStore = require('../store/authStore').default;
const { getMyAdvisorRequests, checkAdvisorWindow } = require('../api/advisorService');
const apiClient = require('../api/apiClient').default;

describe('ProfessorInbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_prof_1', role: 'professor' } })
    );
    checkAdvisorWindow.mockResolvedValue({ open: true });
    apiClient.patch.mockImplementation(() => Promise.resolve({ data: {} }));
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
    expect(checkAdvisorWindow).toHaveBeenCalled();
  });

  it('approves a pending request and sends PATCH with decision payload', async () => {
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

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Orion')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Team Orion'));
    });
    const requestCard = screen.getByText('Team Orion').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    await user.click(approveButton);

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        expect.stringContaining('/advisor-requests/req_approve'),
        expect.objectContaining({ decision: 'approve' })
      );
    });
    const patchCalls = apiClient.patch.mock.calls;
    const body = patchCalls[patchCalls.length - 1][1];
    expect(body).toMatchObject({ decision: 'approve' });
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

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Phoenix')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Team Phoenix'));
    });
    const requestCard = screen.getByText('Team Phoenix').closest('.request-card');
    const textarea = within(requestCard).getByPlaceholderText(/Reason for rejection/i);
    await user.type(textarea, 'My capacity is limited.');
    const rejectButton = within(requestCard).getByRole('button', { name: /Reject/i });
    await user.click(rejectButton);

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        expect.stringContaining('/advisor-requests/req_reject'),
        { decision: 'reject', reason: 'My capacity is limited.' }
      );
    });
  });

  it('disables approve and reject when the advisor association schedule window is closed', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: false });
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_closed_win',
        groupId: 'grp_w',
        groupName: 'Team ClosedWin',
        requesterId: 'usr_leader_x',
        status: 'pending',
        message: 'Hi',
      },
    ]);

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team ClosedWin')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText('Team ClosedWin'));
    });
    const requestCard = screen.getByText('Team ClosedWin').closest('.request-card');
    expect(within(requestCard).getByRole('button', { name: /Approve/i })).toBeDisabled();
    expect(within(requestCard).getByRole('button', { name: /Reject/i })).toBeDisabled();
    expect(within(requestCard).getByPlaceholderText(/Reason for rejection/i)).toBeDisabled();
  });

  it('shows schedule closed error when decision endpoint returns 422 and locks decision controls', async () => {
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
    apiClient.patch.mockRejectedValueOnce({ response: { status: 422 } });

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Atlas')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText('Team Atlas'));
    });
    const requestCard = screen.getByText('Team Atlas').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    await act(async () => {
      fireEvent.click(approveButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Advisor association window is currently closed/i)).toBeInTheDocument();
    });
    expect(within(requestCard).getByRole('button', { name: /Approve/i })).toBeDisabled();
    expect(within(requestCard).getByRole('button', { name: /Reject/i })).toBeDisabled();
    expect(within(requestCard).getByPlaceholderText(/Reason for rejection/i)).toBeDisabled();
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
    apiClient.patch.mockRejectedValueOnce({
      response: { status: 409, data: { details: { decision: 'approve' } } },
    });

    render(<ProfessorInbox />);

    await waitFor(() => expect(screen.getByText('Team Voyager')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText('Team Voyager'));
    });
    const requestCard = screen.getByText('Team Voyager').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    await act(async () => {
      fireEvent.click(approveButton);
    });

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
