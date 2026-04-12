import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import CommitteeManagementTab from '../components/CommitteeManagementTab';
import JuryCommittees from '../components/JuryCommittees';
import DeliverableSubmissionForm from '../components/DeliverableSubmissionForm';
import * as committeeService from '../api/committeeService';
import * as groupService from '../api/groupService';
import * as deliverableService from '../api/deliverableService';
import useAuthStore from '../store/authStore';

jest.mock('../store/authStore');
jest.mock('../api/committeeService');
jest.mock('../api/groupService', () => ({
  getScheduleWindow: jest.fn(),
  getJuryCommittees: jest.fn(),
}));
jest.mock('../api/deliverableService', () => ({
  getGroupDeliverables: jest.fn(),
  submitDeliverable: jest.fn(),
}));

describe('Issue #90 — Committee E2E-style flows (RTL)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_coordinator', role: 'coordinator' } })
    );
  });

  describe('E2E Journey 1: Coordinator full flow', () => {
    let committeesState;

    beforeEach(() => {
      committeesState = [];

      committeeService.listCommittees.mockImplementation(() =>
        Promise.resolve({ committees: [...committeesState] })
      );

      committeeService.listCommitteeCandidates.mockResolvedValue({
        professors: [
          { userId: 'adv1', email: 'advisor1@test.edu' },
          { userId: 'jury1', email: 'jury1@test.edu' },
        ],
      });

      committeeService.createCommittee.mockImplementation(async (payload) => {
        const committeeId = 'c-e2e-flow';
        committeesState = [
          {
            committeeId,
            committeeName: payload.committeeName,
            description: payload.description || '',
            status: 'draft',
            advisorIds: [],
            juryIds: [],
            createdAt: '2026-04-13T00:00:00Z',
          },
        ];
        return { committeeId, committeeName: payload.committeeName };
      });

      committeeService.assignCommitteeAdvisors.mockImplementation(async (committeeId, advisorIds) => {
        const c = committeesState.find((x) => x.committeeId === committeeId);
        if (c) c.advisorIds = [...advisorIds];
        return {};
      });

      committeeService.addJuryMembers.mockImplementation(async (committeeId, juryIds) => {
        const c = committeesState.find((x) => x.committeeId === committeeId);
        if (c) c.juryIds = [...juryIds];
        return {};
      });

      committeeService.validateCommitteeSetup.mockResolvedValue({
        valid: true,
        missingRequirements: [],
      });

      committeeService.publishCommittee.mockImplementation(async (committeeId) => {
        const c = committeesState.find((x) => x.committeeId === committeeId);
        if (c) c.status = 'published';
        return { committeeId, status: 'published' };
      });
    });

    it('creates, assigns, validates, publishes, and calls publishCommittee with the committee id', async () => {
      const user = userEvent.setup();
      jest.spyOn(window, 'confirm').mockReturnValue(true);

      render(<CommitteeManagementTab />);

      await screen.findByPlaceholderText(/enter committee name/i);

      await user.type(screen.getByPlaceholderText(/enter committee name/i), 'E2E Flow Committee');
      await user.click(screen.getByRole('button', { name: /create committee draft/i }));

      await screen.findByText(/Committee "E2E Flow Committee" created successfully/i);

      const multiSelects = document.querySelectorAll('select[multiple]');
      expect(multiSelects.length).toBeGreaterThanOrEqual(2);

      await user.selectOptions(multiSelects[0], 'adv1');
      await user.click(screen.getByRole('button', { name: /save advisors/i }));

      await waitFor(() => {
        expect(committeeService.assignCommitteeAdvisors).toHaveBeenCalledWith('c-e2e-flow', ['adv1']);
      });

      const multiSelectsAfterAdvisor = document.querySelectorAll('select[multiple]');
      await user.selectOptions(multiSelectsAfterAdvisor[1], 'jury1');
      await user.click(screen.getByRole('button', { name: /save jury/i }));

      await waitFor(() => {
        expect(committeeService.addJuryMembers).toHaveBeenCalledWith('c-e2e-flow', ['jury1']);
      });

      await user.click(screen.getByRole('button', { name: /validate committee/i }));

      await screen.findByText(/Validation: Valid/i);

      await user.click(screen.getByRole('button', { name: /publish committee/i }));

      await waitFor(() => {
        expect(committeeService.publishCommittee).toHaveBeenCalledWith('c-e2e-flow');
      });

      window.confirm.mockRestore();
    });
  });

  describe('E2E Journey 2: Jury read-only view', () => {
    const publishedCommittee = {
      committeeId: 'c-jury-e2e',
      committeeName: 'Jury Visible Committee',
      status: 'published',
      publishedAt: '2026-04-13T00:00:00Z',
      advisorIds: ['adv1'],
      juryIds: ['jury1'],
    };

    it('shows committee details without coordinator management controls', async () => {
      groupService.getJuryCommittees.mockResolvedValue({ committees: [publishedCommittee] });

      render(<JuryCommittees />);

      expect(await screen.findByText('Jury Visible Committee')).toBeInTheDocument();
      expect(screen.getByText('c-jury-e2e')).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /validate/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create committee draft/i })).not.toBeInTheDocument();
    });
  });

  describe('E2E Journey 3: Student deliverable submission', () => {
    beforeEach(() => {
      groupService.getScheduleWindow.mockResolvedValue({
        open: true,
        window: { endsAt: '2026-04-20T00:00:00Z' },
      });
      deliverableService.getGroupDeliverables.mockResolvedValue({ deliverables: [] });
      deliverableService.submitDeliverable.mockResolvedValue({
        type: 'proposal',
        deliverableId: 'del-e2e-1',
        submittedAt: '2026-04-13T12:00:00Z',
        storageRef: 'https://example.com/proposal.pdf',
      });
    });

    it('submits a proposal file and shows success when committee is published', async () => {
      const user = userEvent.setup();

      render(
        <DeliverableSubmissionForm
          groupId="g-e2e"
          isLeader={true}
          userId="usr_student"
          members={[{ userId: 'usr_student' }]}
          committeeStatus="published"
        />
      );

      await screen.findByLabelText(/deliverable type/i);

      await user.selectOptions(screen.getByLabelText(/deliverable type/i), 'proposal');

      const fileInput = screen.getByLabelText(/file \(pdf/i);
      const file = new File(['proposal'], 'proposal.pdf', { type: 'application/pdf' });
      await user.upload(fileInput, file);

      await user.click(screen.getByRole('button', { name: /submit deliverable/i }));

      await waitFor(() => {
        expect(deliverableService.submitDeliverable).toHaveBeenCalled();
      });

      expect(await screen.findByText(/deliverable submitted successfully/i)).toBeInTheDocument();
    });
  });
});
