import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import Dashboard from '../components/Dashboard';

jest.mock('../store/authStore', () => jest.fn());
jest.mock('../api/groupService', () => ({
  getMyPendingInvitation: jest.fn(),
}));
jest.mock('../api/advisorService', () => ({
  getMyAdvisorRequests: jest.fn(),
  decideOnAdvisorRequest: jest.fn(),
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));

const useAuthStore = require('../store/authStore').default;
const { getMyAdvisorRequests, decideOnAdvisorRequest } = require('../api/advisorService');

describe('Dashboard advisor decision panel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders professor pending advisor requests', async () => {
    useAuthStore.mockImplementation((selector) =>
      selector({
        user: { role: 'professor', name: 'Dr. Ada' },
      })
    );

    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'arq_1',
        groupId: 'grp_1',
        requesterId: 'usr_student_1',
        message: 'Please guide us.',
      },
    ]);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Advisor Requests')).toBeInTheDocument();
      expect(screen.getByText(/grp_1/)).toBeInTheDocument();
      expect(screen.getByText('Please guide us.')).toBeInTheDocument();
    });
  });

  it('approves request with reason and sends correct payload', async () => {
    const user = userEvent.setup();
    useAuthStore.mockImplementation((selector) =>
      selector({
        user: { role: 'professor', name: 'Dr. Ada' },
      })
    );

    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'arq_approve',
        groupId: 'grp_approve',
        requesterId: 'usr_student_2',
        message: '',
      },
    ]);

    decideOnAdvisorRequest.mockResolvedValue({
      requestId: 'arq_approve',
      assignedGroupId: 'grp_approve',
    });

    render(<Dashboard />);

    const reasonBox = await screen.findByPlaceholderText('Optional reason');
    await user.type(reasonBox, 'I can supervise this project');
    await user.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(decideOnAdvisorRequest).toHaveBeenCalledWith(
        'arq_approve',
        'approve',
        'I can supervise this project'
      );
    });
  });

  it('shows schedule closed error on 422 response', async () => {
    const user = userEvent.setup();
    useAuthStore.mockImplementation((selector) =>
      selector({
        user: { role: 'professor', name: 'Dr. Ada' },
      })
    );

    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'arq_closed',
        groupId: 'grp_closed',
        requesterId: 'usr_student_3',
        message: '',
      },
    ]);

    decideOnAdvisorRequest.mockRejectedValue({
      response: { status: 422 },
    });

    render(<Dashboard />);

    await user.click(await screen.findByText('Reject'));

    await waitFor(() => {
      expect(screen.getByText('Advisor association schedule is closed.')).toBeInTheDocument();
    });
  });
});
