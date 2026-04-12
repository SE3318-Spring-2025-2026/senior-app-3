import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import CoordinatorPanel from '../components/CoordinatorPanel';

jest.mock('../store/authStore');
jest.mock('../api/groupService', () => ({
  listScheduleWindows: jest.fn(),
  createScheduleWindow: jest.fn(),
  deactivateScheduleWindow: jest.fn(),
  getAllGroups: jest.fn(),
  coordinatorOverride: jest.fn(),
  transferAdvisor: jest.fn(),
  getGroupStatus: jest.fn(),
  transitionGroupStatus: jest.fn(),
}));
jest.mock('../api/committeeService', () => ({
  listCommittees: jest.fn(),
}));

const useAuthStore = require('../store/authStore').default;
const groupService = require('../api/groupService');
const committeeService = require('../api/committeeService');

describe('Coordinator advisor transfer form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'coord_1', role: 'coordinator', name: 'Coordinator' } })
    );
    groupService.getAllGroups.mockResolvedValue({
      groups: [
        {
          groupId: 'grp_tr',
          groupName: 'Team Transfer',
          leaderId: 'lead_1',
          status: 'active',
          advisorId: 'usr_prof_old',
          memberCount: 3,
        },
      ],
    });
    groupService.listScheduleWindows.mockResolvedValue({ windows: [] });
    committeeService.listCommittees.mockResolvedValue({ committees: [] });
  });

  it('does not call transferAdvisor when submitted without a new professor id', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Coordinator Panel')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Advisor Transfer/i }));

    await waitFor(() => expect(screen.getByLabelText(/New Professor ID/i)).toBeInTheDocument());

    const groupSelect = screen.getByLabelText(/^Group$/i);
    await user.selectOptions(groupSelect, 'grp_tr');

    const form = screen.getByText('Transfer Advisor').closest('form');
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(screen.getByText(/New professor ID is required/i)).toBeInTheDocument();
    });
    expect(groupService.transferAdvisor).not.toHaveBeenCalled();
  });
});
