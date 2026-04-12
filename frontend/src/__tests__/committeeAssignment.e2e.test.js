import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import useAuthStore from '../store/authStore';
import {
  createCommittee,
  assignAdvisors,
  assignJury,
  validateCommittee,
  publishCommittee,
} from '../api/committeeService';
import { submitDeliverable } from '../api/deliverableService';
import CommitteeCreationForm from '../components/committee/CommitteeCreationForm';
import AdvisorAssignmentPanel from '../components/committee/AdvisorAssignmentPanel';
import JuryAssignmentPanel from '../components/committee/JuryAssignmentPanel';
import CommitteeValidationCard from '../components/committee/CommitteeValidationCard';
import PublishConfirmationDialog from '../components/committee/PublishConfirmationDialog';
import StudentCommitteeStatus from '../components/committee/StudentCommitteeStatus';
import JuryCommitteePanel from '../components/committee/JuryCommitteePanel';
import DeliverableSubmissionForm from '../components/committee/DeliverableSubmissionForm';

jest.mock('../store/authStore', () => jest.fn());
jest.mock('../api/committeeService', () => ({
  createCommittee: jest.fn(),
  assignAdvisors: jest.fn(),
  assignJury: jest.fn(),
  validateCommittee: jest.fn(),
  publishCommittee: jest.fn(),
}));
jest.mock('../api/deliverableService', () => ({
  submitDeliverable: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.mockImplementation((selector) =>
    selector({ user: { userId: 'coordinator-1', role: 'coordinator' }, isAuthenticated: true })
  );
});

const CommitteeAssignmentFlow = () => {
  const [committee, setCommittee] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [committeePublished, setCommitteePublished] = useState(null);

  const handleCreateSuccess = (created) => {
    setCommittee(created);
    setCommitteePublished(null);
    setValidationResult(null);
  };

  const handleValidate = async () => {
    if (!committee) return;
    const result = await validateCommittee(committee.committeeId);
    setValidationResult(result);
  };

  const handlePublish = () => {
    setPublishOpen(true);
  };

  const handleConfirmPublish = async () => {
    if (!committee) return;
    const result = await publishCommittee(committee.committeeId);
    const published = {
      ...committee,
      status: 'published',
      publishedAt: result.publishedAt,
      advisorIds: ['a1'],
      juryIds: ['j1'],
    };
    setCommittee(published);
    setCommitteePublished(published);
    setPublishOpen(false);
  };

  return (
    <div>
      <CommitteeCreationForm onCreateSuccess={handleCreateSuccess} />
      <AdvisorAssignmentPanel
        committeeId={committee?.committeeId}
        availableAdvisors={[{ id: 'a1', name: 'Advisor 1' }]}
      />
      <JuryAssignmentPanel
        committeeId={committee?.committeeId}
        availableJury={[{ id: 'j1', name: 'Jury 1' }]}
      />
      <button type="button" data-testid="validate-committee-btn" onClick={handleValidate}>
        Validate Committee
      </button>
      <CommitteeValidationCard
        validationResult={validationResult}
        onPublishClick={handlePublish}
        disabled={committee?.status === 'published'}
      />
      <PublishConfirmationDialog
        open={publishOpen}
        committeeName={committee?.committeeName || ''}
        onCancel={() => setPublishOpen(false)}
        onConfirm={handleConfirmPublish}
      />
      <StudentCommitteeStatus committee={committeePublished} />
      <JuryCommitteePanel committees={committeePublished ? [committeePublished] : []} />
      <DeliverableSubmissionForm committee={committeePublished} groupId="g1" scheduleOpen={true} />
    </div>
  );
};

describe('Committee Assignment E2E flow', () => {
  it('creates committee, assigns advisors/jury, validates, publishes, and submits deliverable', async () => {
    const user = userEvent.setup();

    createCommittee.mockResolvedValue({
      committeeId: 'c1',
      committeeName: 'Test Committee',
      status: 'draft',
    });
    assignAdvisors.mockResolvedValue({});
    assignJury.mockResolvedValue({});
    validateCommittee.mockResolvedValue({ valid: true, missingRequirements: [] });
    publishCommittee.mockResolvedValue({ publishedAt: '2026-04-13T12:00:00Z' });
    submitDeliverable.mockResolvedValue({
      deliverableId: 'd1',
      submittedAt: '2026-04-13T12:05:00Z',
      storageRef: 'https://example.com/d1',
    });

    render(<CommitteeAssignmentFlow />);

    // Create committee
    await user.type(screen.getByTestId('committee-name-input'), 'Test Committee');
    await user.click(screen.getByTestId('committee-submit-btn'));
    await waitFor(() => expect(createCommittee).toHaveBeenCalled());

    // Assign advisor
    await user.click(screen.getByTestId('advisor-checkbox-a1'));
    await user.click(screen.getByTestId('advisor-submit-btn'));
    await waitFor(() => expect(assignAdvisors).toHaveBeenCalledWith('c1', ['a1']));

    // Assign jury
    await user.click(screen.getByTestId('jury-checkbox-j1'));
    await user.click(screen.getByTestId('jury-submit-btn'));
    await waitFor(() => expect(assignJury).toHaveBeenCalledWith('c1', ['j1']));

    // Validate
    await user.click(screen.getByTestId('validate-committee-btn'));
    await waitFor(() => expect(validateCommittee).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.getByTestId('publish-button')).toBeEnabled());

    // Publish
    await user.click(screen.getByTestId('publish-button'));
    await waitFor(() => expect(screen.getByTestId('publish-confirmation-dialog')).toBeInTheDocument());
    await user.click(screen.getByTestId('publish-confirm-btn'));
    await waitFor(() => expect(publishCommittee).toHaveBeenCalledWith('c1'));

    expect(screen.getByTestId('student-committee-card')).toBeInTheDocument();
    expect(screen.getByTestId('committee-published-at')).toHaveTextContent('Published at: 2026-04-13T12:00:00Z');
    expect(screen.getByTestId('jury-committee-card')).toHaveTextContent('Test Committee');

    // Submit deliverable
    await user.selectOptions(screen.getByTestId('deliverable-type-selector'), 'demonstration');
    await user.type(screen.getByTestId('deliverable-storage-ref'), 'https://example.com/d1');
    await user.click(screen.getByTestId('deliverable-submit-btn'));
    await waitFor(() => expect(submitDeliverable).toHaveBeenCalledWith({
      committeeId: 'c1',
      groupId: 'g1',
      type: 'demonstration',
      storageRef: 'https://example.com/d1',
    }));
    expect(screen.getByTestId('deliverable-success-card')).toBeInTheDocument();
  });
});
