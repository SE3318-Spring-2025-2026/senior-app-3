import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdviseeRequestForm from '../components/AdviseeRequestForm';
import ProfessorInbox from '../components/ProfessorInbox';

jest.mock('../store/authStore');
jest.mock('../api/advisorService');
jest.mock('../api/groupService');
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: jest.fn(),
  useNavigate: jest.fn(),
}));

const useAuthStore = require('../store/authStore').default;
const { getProfessors, submitAdvisorRequest, getMyAdvisorRequests, decideOnAdvisorRequest, checkAdvisorWindow } = require('../api/advisorService');
const { getGroup } = require('../api/groupService');
const { useParams, useNavigate } = require('react-router-dom');

describe('Advisor association flow', () => {
  const navigateMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useNavigate.mockReturnValue(navigateMock);
    useParams.mockReturnValue({ group_id: 'grp_flow' });
  });

  it('lets a team leader submit an advisor request and then a professor approve it', async () => {
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_leader', role: 'student' } })
    );

    getGroup.mockResolvedValue({ groupId: 'grp_flow', leaderId: 'usr_leader' });
    getProfessors.mockResolvedValue([{ userId: 'usr_prof_e2e', name: 'Dr. Lin' }]);
    checkAdvisorWindow.mockResolvedValue({ open: true });
    submitAdvisorRequest.mockResolvedValue({ requestId: 'req_flow', notificationTriggered: true });

    render(
      <MemoryRouter initialEntries={['/groups/grp_flow/advisor-request']}>
        <Routes>
          <Route path="/groups/:group_id/advisor-request" element={<AdviseeRequestForm />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    const comboBox = screen.getByRole('combobox');
    await userEvent.selectOptions(comboBox, 'usr_prof_e2e');
    await userEvent.type(screen.getByLabelText(/Message \(Optional\)/i), 'This project fits my area.');
    await userEvent.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => expect(screen.getByText(/Request Submitted!/i)).toBeInTheDocument());
    expect(submitAdvisorRequest).toHaveBeenCalledWith({
      groupId: 'grp_flow',
      professorId: 'usr_prof_e2e',
      message: 'This project fits my area.',
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
    decideOnAdvisorRequest.mockResolvedValue({ requestId: 'req_flow', assignedGroupId: 'grp_flow' });

    render(
      <MemoryRouter initialEntries={['/professor/inbox']}>
        <Routes>
          <Route path="/professor/inbox" element={<ProfessorInbox />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Team Flow')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Team Flow'));
    const requestCard = screen.getByText('Team Flow').closest('.request-card');
    const approveButton = within(requestCard).getByRole('button', { name: /Approve/i });
    await userEvent.click(approveButton);

    await waitFor(() => {
      expect(decideOnAdvisorRequest).toHaveBeenCalledWith('req_flow', 'approve', null);
    });
  });
});
