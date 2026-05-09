import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CoordinatorFinalGradePublishPanel from '../pages/CoordinatorFinalGradePublishPanel';
import { getGroupApprovalSummary, publishFinalGrades } from '../api/finalGradeService';

jest.mock('../api/finalGradeService', () => ({
  getGroupApprovalSummary: jest.fn(),
  publishFinalGrades: jest.fn(),
}));

const renderPanel = (initialEntries = ['/groups/group-1/final-grades/publish']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/groups/:groupId/final-grades/publish"
          element={<CoordinatorFinalGradePublishPanel />}
        />
      </Routes>
    </MemoryRouter>
  );

describe('CoordinatorFinalGradePublishPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getGroupApprovalSummary.mockResolvedValue({
      summary: [
        { _id: 'approved', count: 2 },
        { _id: 'published', count: 0 },
        { _id: 'pending', count: 1 },
      ],
      activePublishCycle: 'Fall2026',
    });
  });

  it('shows INCONSISTENT_CYCLE message and keeps modal open', async () => {
    publishFinalGrades.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: 'INCONSISTENT_CYCLE',
          error: 'Publish cycle does not match the approved snapshot cycle',
        },
      },
    });

    renderPanel();

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));

    expect(
      await screen.findByText(/The selected cycle does not match the approved records/i)
    ).toBeInTheDocument();
    const warningContainer = screen
      .getByText(/The selected cycle does not match the approved records/i)
      .closest('div');
    expect(warningContainer).toHaveClass('error-message');
    expect(warningContainer).toHaveClass('error-message-warning');
    expect(screen.getByRole('button', { name: /Confirm & Publish/i })).toBeInTheDocument();
    expect(screen.queryByText(/already been published for this cycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grades Published/i)).not.toBeInTheDocument();
  });

  it('maps ALREADY_PUBLISHED to duplicate publish message', async () => {
    publishFinalGrades.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: 'ALREADY_PUBLISHED',
          error: 'Bu notlar zaten yayınlanmış',
        },
      },
    });

    renderPanel();

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));

    await waitFor(() => {
      expect(screen.getByText(/already been published for this cycle/i)).toBeInTheDocument();
    });

    const generalErrorContainer = screen
      .getByText(/already been published for this cycle/i)
      .closest('div');
    expect(generalErrorContainer).toHaveClass('error-message');
    expect(generalErrorContainer).not.toHaveClass('error-message-warning');
    expect(screen.queryByText(/Grades Published/i)).not.toBeInTheDocument();
  });

  it('uses DEFAULT conflict fallback when 409 code is unrecognized', async () => {
    publishFinalGrades.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: 'SOME_UNKNOWN_CONFLICT',
          error: 'Unexpected conflict',
        },
      },
    });

    renderPanel();

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));

    await waitFor(() => {
      expect(screen.getByText(/A conflict error occurred/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Grades Published/i)).not.toBeInTheDocument();
  });

  it('resets error type from cycle warning to general error on next attempt', async () => {
    publishFinalGrades
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: 'INCONSISTENT_CYCLE',
            error: 'Publish cycle does not match the approved snapshot cycle',
          },
        },
      })
      .mockRejectedValueOnce({
        response: {
          status: 500,
          data: {
            error: 'Internal server error',
          },
        },
      });

    renderPanel();

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);

    const confirmButton = screen.getByRole('button', { name: /Confirm & Publish/i });
    await userEvent.click(confirmButton);

    const firstError = await screen.findByText(/The selected cycle does not match the approved records/i);
    const firstContainer = firstError.closest('div');
    expect(firstContainer).toHaveClass('error-message-warning');

    await userEvent.click(confirmButton);

    const secondError = await screen.findByText(/Internal server error/i);
    const secondContainer = secondError.closest('div');
    expect(secondContainer).toHaveClass('error-message');
    expect(secondContainer).not.toHaveClass('error-message-warning');
    expect(screen.queryByText(/Grades Published/i)).not.toBeInTheDocument();
  });
});

describe('Wizard Flow and UI State', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows "Go to Review & Approve" when not published', async () => {
    getGroupApprovalSummary.mockResolvedValue({
      summary: [
        { _id: 'approved', count: 0 },
        { _id: 'published', count: 0 },
        { _id: 'pending', count: 3 },
      ],
      activePublishCycle: 'Fall2026',
    });

    renderPanel();

    await screen.findByRole('button', { name: /Publish Final Grades/i });
    expect(screen.getByText(/Step 2 of 2/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Review & Approve/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Go to Review & Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Approval/i })).toBeInTheDocument();
  });

  it('hides "Go to Review & Approve" when already published', async () => {
    getGroupApprovalSummary.mockResolvedValue({
      summary: [
        { _id: 'approved', count: 0 },
        { _id: 'published', count: 2 },
        { _id: 'pending', count: 0 },
      ],
      activePublishCycle: 'Fall2026',
    });

    renderPanel();

    await screen.findByRole('button', { name: /Publish Final Grades/i });
    expect(screen.getByText(/Step 2 of 2/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Go to Review & Approve/i })).not.toBeInTheDocument();
    expect(screen.getByText(/These grades are already published for this cycle/i)).toBeInTheDocument();
  });

  it('renders step indicators and completes publish success flow', async () => {
    getGroupApprovalSummary.mockResolvedValueOnce({
      summary: [
        { _id: 'approved', count: 2 },
        { _id: 'published', count: 0 },
        { _id: 'pending', count: 1 },
      ],
      activePublishCycle: 'Fall2026',
    });
    getGroupApprovalSummary.mockResolvedValueOnce({
      summary: [
        { _id: 'approved', count: 0 },
        { _id: 'published', count: 2 },
        { _id: 'pending', count: 0 },
      ],
      activePublishCycle: 'Fall2026',
    });
    publishFinalGrades.mockResolvedValue({
      groupId: 'group-1',
      publishCycle: 'Fall2026',
      publishedCount: 2,
      publishedAt: '2026-05-08T10:00:00.000Z',
      notificationStatus: {
        email: true,
        sms: false,
        push: true,
      },
    });

    renderPanel();

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    expect(screen.getByText(/Step 2 of 2/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review & Approve/i })).toBeInTheDocument();
    expect(screen.getByText(/Publish Grades/i)).toBeInTheDocument();

    await userEvent.click(publishButton);
    expect(screen.getByRole('dialog', { name: /Confirm Publication/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));
    expect(publishFinalGrades).toHaveBeenCalledWith('group-1', expect.any(Object));

    expect(await screen.findByRole('heading', { name: /Grades Published/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Confirm Publication/i })).not.toBeInTheDocument();
  });
});
