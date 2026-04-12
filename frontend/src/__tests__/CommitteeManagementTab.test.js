import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import CommitteeManagementTab from '../components/CommitteeManagementTab';
import * as committeeService from '../api/committeeService';
import useAuthStore from '../store/authStore';

jest.mock('../store/authStore');
jest.mock('../api/committeeService');

describe('CommitteeManagementTab', () => {
  const committees = [
    {
      committeeId: 'c1',
      committeeName: 'Alpha Committee',
      description: 'A test committee',
      status: 'draft',
      advisorIds: [],
      juryIds: [],
      createdAt: '2026-04-13T00:00:00Z',
    },
  ];

  const candidates = [
    { userId: 'adv1', email: 'advisor1@test.edu' },
    { userId: 'jury1', email: 'jury1@test.edu' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_coordinator', role: 'coordinator' } })
    );
    committeeService.listCommittees.mockResolvedValue({ committees });
    committeeService.listCommitteeCandidates.mockResolvedValue({ professors: candidates });
    committeeService.assignCommitteeAdvisors.mockResolvedValue({});
    committeeService.addJuryMembers.mockResolvedValue({});
    committeeService.validateCommitteeSetup.mockResolvedValue({ valid: true, missingRequirements: [] });
    committeeService.publishCommittee.mockResolvedValue({ committeeId: 'c1', status: 'published' });
  });

  it('loads committee data and renders the selected committee', async () => {
    render(<CommitteeManagementTab />);

    await screen.findAllByText('Alpha Committee');

    expect(committeeService.listCommittees).toHaveBeenCalled();
    expect(screen.getAllByText('Alpha Committee').length).toBeGreaterThan(0);
    expect(screen.getByText(/Status:/i)).toBeInTheDocument();
    expect(screen.getAllByText('draft').length).toBeGreaterThan(0);
  });

  it('shows an error when saving advisors with no selection', async () => {
    render(<CommitteeManagementTab />);

    await screen.findAllByText('Alpha Committee');

    fireEvent.click(screen.getByRole('button', { name: /save advisors/i }));

    expect(await screen.findByText(/Please select at least one advisor/i)).toBeInTheDocument();
    expect(committeeService.assignCommitteeAdvisors).not.toHaveBeenCalled();
  });

  it('shows an error when saving jury members with no selection', async () => {
    render(<CommitteeManagementTab />);

    await screen.findAllByText('Alpha Committee');

    fireEvent.click(screen.getByRole('button', { name: /save jury/i }));

    expect(await screen.findByText(/Please select at least one jury member/i)).toBeInTheDocument();
    expect(committeeService.addJuryMembers).not.toHaveBeenCalled();
  });

  it('validates and publishes a committee when confirmed', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommitteeManagementTab />);

    await screen.findAllByText('Alpha Committee');

    fireEvent.click(screen.getByRole('button', { name: /validate committee/i }));

    expect(await screen.findByText(/Validation: Valid/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /publish committee/i }));

    await waitFor(() => {
      expect(committeeService.publishCommittee).toHaveBeenCalledWith('c1');
      expect(screen.getByText(/Committee published successfully/i)).toBeInTheDocument();
    });

    window.confirm.mockRestore();
  });
});
