import React from 'react';
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

describe('Committee Assignment UI components', () => {
  it('shows validation error when committee name is empty', async () => {
    const user = userEvent.setup();
    render(<CommitteeCreationForm />);

    await user.click(screen.getByTestId('committee-submit-btn'));

    expect(screen.getByTestId('committee-error')).toHaveTextContent('Committee name is required.');
    expect(createCommittee).not.toHaveBeenCalled();
  });

  it('shows duplicate name error from API without reload', async () => {
    const user = userEvent.setup();
    createCommittee.mockRejectedValue({ response: { data: { message: 'Duplicate committee name' } } });

    render(<CommitteeCreationForm />);
    await user.type(screen.getByTestId('committee-name-input'), 'Test Committee');
    await user.click(screen.getByTestId('committee-submit-btn'));

    await waitFor(() => expect(createCommittee).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('committee-error')).toHaveTextContent('Duplicate committee name');
  });

  it('submits a valid committee creation request', async () => {
    const user = userEvent.setup();
    createCommittee.mockResolvedValue({ committeeId: 'c1', committeeName: 'Test Committee' });
    const handleSuccess = jest.fn();

    render(<CommitteeCreationForm onCreateSuccess={handleSuccess} />);

    await user.type(screen.getByTestId('committee-name-input'), 'Test Committee');
    await user.type(screen.getByTestId('committee-description-input'), 'Description');
    await user.click(screen.getByTestId('committee-submit-btn'));

    await waitFor(() => expect(createCommittee).toHaveBeenCalledWith({
      committeeName: 'Test Committee',
      description: 'Description',
      coordinatorId: 'coordinator-1',
    }));
    expect(handleSuccess).toHaveBeenCalledWith({ committeeId: 'c1', committeeName: 'Test Committee' });
    expect(screen.getByTestId('committee-success')).toHaveTextContent('Committee created successfully.');
  });

  it('shows advisor selection error when none are selected', async () => {
    const user = userEvent.setup();
    render(<AdvisorAssignmentPanel committeeId="c1" availableAdvisors={[{ id: 'a1', name: 'Advisor 1' }]} />);

    await user.click(screen.getByTestId('advisor-submit-btn'));

    expect(screen.getByTestId('advisor-error')).toHaveTextContent('Please select at least one advisor.');
    expect(assignAdvisors).not.toHaveBeenCalled();
  });

  it('calls POST advisors with correct payload on valid advisor assignment', async () => {
    const user = userEvent.setup();
    assignAdvisors.mockResolvedValue({});

    render(<AdvisorAssignmentPanel committeeId="c1" availableAdvisors={[{ id: 'a1', name: 'Advisor 1' }, { id: 'a2', name: 'Advisor 2' }]} />);

    await user.click(screen.getByTestId('advisor-checkbox-a1'));
    await user.click(screen.getByTestId('advisor-submit-btn'));

    await waitFor(() => expect(assignAdvisors).toHaveBeenCalledWith('c1', ['a1']));
    expect(screen.getByTestId('advisor-success')).toHaveTextContent('Advisors assigned successfully.');
  });

  it('shows jury selection error when none are selected', async () => {
    const user = userEvent.setup();
    render(<JuryAssignmentPanel committeeId="c1" availableJury={[{ id: 'j1', name: 'Jury 1' }]} />);

    await user.click(screen.getByTestId('jury-submit-btn'));

    expect(screen.getByTestId('jury-error')).toHaveTextContent('Please select at least one jury member.');
    expect(assignJury).not.toHaveBeenCalled();
  });

  it('calls POST jury with correct payload on valid jury assignment', async () => {
    const user = userEvent.setup();
    assignJury.mockResolvedValue({});

    render(<JuryAssignmentPanel committeeId="c1" availableJury={[{ id: 'j1', name: 'Jury 1' }, { id: 'j2', name: 'Jury 2' }]} />);

    await user.click(screen.getByTestId('jury-checkbox-j2'));
    await user.click(screen.getByTestId('jury-submit-btn'));

    await waitFor(() => expect(assignJury).toHaveBeenCalledWith('c1', ['j2']));
    expect(screen.getByTestId('jury-success')).toHaveTextContent('Jury members assigned successfully.');
  });

  it('enables publish button when validation result is valid', () => {
    render(<CommitteeValidationCard validationResult={{ valid: true }} onPublishClick={() => {}} />);

    expect(screen.getByTestId('publish-button')).toBeEnabled();
    expect(screen.getByTestId('validation-status')).toHaveTextContent('Valid committee configuration');
  });

  it('disables publish button and shows missing requirements when invalid', () => {
    render(
      <CommitteeValidationCard
        validationResult={{ valid: false, missingRequirements: ['Advisor count too low'] }}
        onPublishClick={() => {}}
      />
    );

    expect(screen.getByTestId('publish-button')).toBeDisabled();
    expect(screen.getByTestId('missing-requirements')).toHaveTextContent('Advisor count too low');
  });

  it('renders publish confirmation dialog and handles cancel/confirm actions', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    const onConfirm = jest.fn();

    render(
      <PublishConfirmationDialog
        open={true}
        committeeName="Test Committee"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByTestId('publish-confirmation-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('publish-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('publish-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders placeholder before publish and full card after publish for student status', () => {
    const { rerender } = render(<StudentCommitteeStatus committee={null} />);
    expect(screen.getByTestId('student-committee-placeholder')).toBeInTheDocument();

    rerender(
      <StudentCommitteeStatus
        committee={{
          committeeName: 'Final Committee',
          status: 'published',
          publishedAt: '2026-04-13T10:00:00Z',
          advisorIds: ['a1'],
          juryIds: ['j1'],
        }}
      />
    );

    expect(screen.getByTestId('student-committee-card')).toBeInTheDocument();
    expect(screen.getByTestId('advisor-list')).toHaveTextContent('a1');
    expect(screen.getByTestId('jury-list')).toHaveTextContent('j1');
  });

  it('renders jury panel empty state and read-only assignment cards', () => {
    const { rerender } = render(<JuryCommitteePanel committees={[]} />);
    expect(screen.getByTestId('jury-empty-state')).toHaveTextContent('No committee assignments yet.');

    rerender(
      <JuryCommitteePanel
        committees={[{ committeeId: 'c1', committeeName: 'Committee 1', status: 'published', publishedAt: '2026-04-13', advisorIds: ['a1'], juryIds: ['j1'] }]}
      />
    );

    expect(screen.getByTestId('jury-committees-list')).toBeInTheDocument();
    expect(screen.getByTestId('jury-committee-card')).toHaveTextContent('Committee 1');
  });

  it('locks deliverable form before publish and on schedule boundary, and submits successfully when open', async () => {
    const user = userEvent.setup();
    submitDeliverable.mockResolvedValue({ deliverableId: 'd1', submittedAt: '2026-04-13T12:00:00Z', storageRef: 'https://example.com/d1' });

    const { rerender } = render(<DeliverableSubmissionForm committee={null} groupId="g1" />);
    expect(screen.getByTestId('deliverable-locked')).toHaveTextContent('Committee not yet published.');

    rerender(<DeliverableSubmissionForm committee={{ committeeId: 'c1', status: 'published' }} groupId="g1" scheduleOpen={false} />);
    expect(screen.getByTestId('deliverable-locked')).toHaveTextContent('Deliverable submission is closed by schedule.');

    rerender(<DeliverableSubmissionForm committee={{ committeeId: 'c1', status: 'published' }} groupId="g1" scheduleOpen={true} />);
    await user.selectOptions(screen.getByTestId('deliverable-type-selector'), 'statement-of-work');
    await user.type(screen.getByTestId('deliverable-storage-ref'), 'https://example.com/submission');
    await user.click(screen.getByTestId('deliverable-submit-btn'));

    await waitFor(() => expect(submitDeliverable).toHaveBeenCalledWith({
      committeeId: 'c1',
      groupId: 'g1',
      type: 'statement-of-work',
      storageRef: 'https://example.com/submission',
    }));
    expect(screen.getByTestId('deliverable-success-card')).toHaveTextContent('Submission successful!');
  });
});
