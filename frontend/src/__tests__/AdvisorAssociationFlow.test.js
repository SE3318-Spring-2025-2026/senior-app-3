import React from 'react';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdviseeRequestForm from '../components/AdviseeRequestForm';
import ProfessorInbox from '../components/ProfessorInbox';
import GroupDashboard from '../components/GroupDashboard';

jest.mock('../store/authStore');
jest.mock('../store/groupStore');
jest.mock('../api/advisorService');
jest.mock('../api/groupService', () => ({
  ...jest.requireActual('../api/groupService'),
  getGroup: jest.fn(),
  getMyPendingInvitation: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: jest.fn(),
  useNavigate: jest.fn(),
}));

const useAuthStore = require('../store/authStore').default;
const useGroupStore = require('../store/groupStore').default;
const {
  getProfessors,
  submitAdvisorRequest,
  getMyAdvisorRequests,
  decideOnAdvisorRequest,
  checkAdvisorWindow,
} = require('../api/advisorService');
const groupServiceApi = require('../api/groupService');
const { getGroup } = groupServiceApi;
const { useParams, useNavigate } = require('react-router-dom');

describe('Advisor association flow', () => {
  const navigateMock = jest.fn();

  beforeEach(() => {
    useNavigate.mockReturnValue(navigateMock);
    useParams.mockReturnValue({ group_id: 'grp_flow' });
    groupServiceApi.getMyPendingInvitation.mockResolvedValue(null);
  });

  it('completes leader request, professor approval, and shows assigned advisor on the group dashboard', async () => {
    const user = userEvent.setup();

    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_leader', role: 'student' } })
    );

    getGroup.mockResolvedValue({ groupId: 'grp_flow', leaderId: 'usr_leader' });
    getProfessors.mockResolvedValue([{ userId: 'usr_prof_e2e', name: 'Dr. Lin' }]);
    checkAdvisorWindow.mockResolvedValue({ open: true });
    submitAdvisorRequest.mockResolvedValue({ requestId: 'req_flow', notificationTriggered: true });

    const { unmount: unmountForm } = render(
      <MemoryRouter initialEntries={['/groups/grp_flow/advisor-request']}>
        <Routes>
          <Route path="/groups/:group_id/advisor-request" element={<AdviseeRequestForm />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Choose a Professor/i })).toBeInTheDocument());

    // Open dropdown and select professor
    const dropdownButton = screen.getByRole('button', { name: /Choose a Professor/i });
    await user.click(dropdownButton);
    
    const professorOption = await screen.findByRole('option', { name: /\(usr_prof_e2e\)/i });
    await user.click(professorOption);
    await user.type(screen.getByLabelText(/Message \(Optional\)/i), 'This project fits my area.');
    await user.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => expect(screen.getByText(/Request Submitted!/i)).toBeInTheDocument());
    expect(submitAdvisorRequest).toHaveBeenCalledWith({
      groupId: 'grp_flow',
      professorId: 'usr_prof_e2e',
      message: 'This project fits my area.',
    });

    await act(async () => {
      unmountForm();
    });

    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_prof_e2e', role: 'professor' } })
    );
    getMyAdvisorRequests.mockResolvedValue([
      {
        requestId: 'req_flow',
        groupId: 'grp_flow',
        groupName: 'Team Flow',
        requesterId: 'usr_leader',
        status: 'pending',
        message: 'This project fits my area.',
      },
    ]);
    checkAdvisorWindow.mockResolvedValue({ open: true });
    decideOnAdvisorRequest.mockResolvedValue({
      requestId: 'req_flow',
      assignedGroupId: 'grp_flow',
      advisorName: 'Smith',
    });

    const { unmount: unmountInbox } = render(
      <MemoryRouter initialEntries={['/professor/inbox']}>
        <Routes>
          <Route path="/professor/inbox" element={<ProfessorInbox />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Team Flow')).toBeInTheDocument());
    await user.click(screen.getByText('Team Flow'));
    const requestCard = screen.getByText('Team Flow').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    await user.click(approveButton);

    await waitFor(() => {
      expect(decideOnAdvisorRequest).toHaveBeenCalledWith('req_flow', 'approve', null);
    });

    await act(async () => {
      unmountInbox();
    });

    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_leader', role: 'student' } })
    );
    useParams.mockReturnValue({ group_id: 'grp_flow' });
    useGroupStore.mockReturnValue({
      groupData: {
        groupId: 'grp_flow',
        groupName: 'Team Flow',
        leaderId: 'usr_leader',
        status: 'active',
        advisorId: 'usr_prof_e2e',
        advisorName: 'Smith',
      },
      members: [],
      github: { connected: false, repo_url: null, last_synced: null },
      jira: { connected: false, project_key: null, board_url: null },
      pendingApprovalsCount: 0,
      isLoading: false,
      error: null,
      lastUpdated: new Date().toISOString(),
      fetchGroupDashboard: jest.fn(),
      startPolling: jest.fn(() => 1),
      stopPolling: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/groups/grp_flow']}>
        <Routes>
          <Route path="/groups/:group_id" element={<GroupDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Dr\.\s*Smith/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Team Flow')).toBeInTheDocument();
  });
});
