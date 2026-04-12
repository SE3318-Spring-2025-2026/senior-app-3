import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import * as groupService from '../api/groupService';
import * as deliverableService from '../api/deliverableService';
import DeliverableSubmissionForm from '../components/DeliverableSubmissionForm';

jest.mock('../api/groupService', () => ({
  getScheduleWindow: jest.fn(),
  getGroupDeliverables: jest.fn(),
}));
jest.mock('../api/deliverableService', () => ({
  getGroupDeliverables: jest.fn(),
  submitDeliverable: jest.fn(),
}));

describe('DeliverableSubmissionForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks the form before the committee is published', () => {
    render(
      <DeliverableSubmissionForm
        groupId="g1"
        isLeader={true}
        userId="usr_student"
        members={[{ userId: 'usr_student' }]}
        committeeStatus="draft"
      />
    );

    expect(screen.getByText(/Deliverable submission is locked until the committee assignment is published/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Deliverable Type/i)).not.toBeInTheDocument();
  });

  it('renders type selector and submit controls when published and window open', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true, window: { endsAt: '2026-04-20T00:00:00Z' } });
    groupService.getGroupDeliverables.mockResolvedValue({ deliverables: [] });

    render(
      <DeliverableSubmissionForm
        groupId="g1"
        isLeader={true}
        userId="usr_student"
        members={[{ userId: 'usr_student' }]}
        committeeStatus="published"
      />
    );

    expect(await screen.findByLabelText(/Deliverable Type/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Deliverable/i })).not.toBeDisabled();
  });

  it('shows submission success message after submitting a link', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true, window: { endsAt: '2026-04-20T00:00:00Z' } });
    groupService.getGroupDeliverables.mockResolvedValue({ deliverables: [] });
    deliverableService.submitDeliverable.mockResolvedValue({
      type: 'proposal',
      deliverableId: 'd1',
      submittedAt: '2026-04-13T00:00:00Z',
      storageRef: 'https://example.com/proposal.pdf',
    });

    render(
      <DeliverableSubmissionForm
        groupId="g1"
        isLeader={true}
        userId="usr_student"
        members={[{ userId: 'usr_student' }]}
        committeeStatus="published"
      />
    );

    await screen.findByLabelText(/Deliverable Type/i);

    const fileInput = screen.getByLabelText(/File \(PDF, Word, Markdown, ZIP\)/i);
    const file = new File(['dummy content'], 'proposal.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, file);

    fireEvent.click(screen.getByRole('button', { name: /Submit Deliverable/i }));

    expect(await screen.findByText('d1')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/proposal.pdf')).toBeInTheDocument();
    expect(deliverableService.submitDeliverable).toHaveBeenCalled();
  });

  it('disables submission when the schedule window is closed', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: false, window: { endsAt: '2026-04-20T00:00:00Z' } });
    groupService.getGroupDeliverables.mockResolvedValue({ deliverables: [] });

    render(
      <DeliverableSubmissionForm
        groupId="g1"
        isLeader={true}
        userId="usr_student"
        members={[{ userId: 'usr_student' }]}
        committeeStatus="published"
      />
    );

    await screen.findByText(/Submission window closed/i);
    expect(screen.getByRole('button', { name: /Submit Deliverable/i })).toBeDisabled();
  });
});
