import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CoordinatorFinalGradePublishPanel from '../pages/CoordinatorFinalGradePublishPanel';
import { getGroupApprovalSummary, publishFinalGrades } from '../api/finalGradeService';

jest.mock('../api/finalGradeService', () => ({
  getGroupApprovalSummary: jest.fn(),
  publishFinalGrades: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ groupId: 'group-1' }),
  useNavigate: () => jest.fn(),
}));

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

    render(<CoordinatorFinalGradePublishPanel />);

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));

    expect(
      await screen.findByText(/Seçilen dönem onaylanan kayıtlarla eşleşmiyor/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/⚠️/)).toBeInTheDocument();
    const warningContainer = screen.getByText(/Seçilen dönem onaylanan kayıtlarla eşleşmiyor/i).closest('div');
    expect(warningContainer).toHaveClass('error-message');
    expect(warningContainer).toHaveClass('error-message-warning');
    expect(screen.getByRole('button', { name: /Confirm & Publish/i })).toBeInTheDocument();
    expect(screen.queryByText(/zaten yayınlanmış/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Published Summary/i)).not.toBeInTheDocument();
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

    render(<CoordinatorFinalGradePublishPanel />);

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));

    await waitFor(() => {
      expect(screen.getByText(/Bu notlar zaten yayınlanmış/i)).toBeInTheDocument();
    });

    const generalErrorContainer = screen.getByText(/Bu notlar zaten yayınlanmış/i).closest('div');
    expect(generalErrorContainer).toHaveClass('error-message');
    expect(generalErrorContainer).not.toHaveClass('error-message-warning');
    expect(screen.queryByText(/Published Summary/i)).not.toBeInTheDocument();
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

    render(<CoordinatorFinalGradePublishPanel />);

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Publish/i }));

    await waitFor(() => {
      expect(screen.getByText(/Bir çakışma hatası oluştu/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Published Summary/i)).not.toBeInTheDocument();
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

    render(<CoordinatorFinalGradePublishPanel />);

    const publishButton = await screen.findByRole('button', { name: /Publish Final Grades/i });
    await userEvent.click(publishButton);

    const confirmButton = screen.getByRole('button', { name: /Confirm & Publish/i });
    await userEvent.click(confirmButton);

    const firstError = await screen.findByText(/Seçilen dönem onaylanan kayıtlarla eşleşmiyor/i);
    const firstContainer = firstError.closest('div');
    expect(firstContainer).toHaveClass('error-message-warning');
    expect(screen.getByText(/⚠️/)).toBeInTheDocument();

    await userEvent.click(confirmButton);

    const secondError = await screen.findByText(/Internal server error/i);
    const secondContainer = secondError.closest('div');
    expect(secondContainer).toHaveClass('error-message');
    expect(secondContainer).not.toHaveClass('error-message-warning');
    expect(screen.getByText(/❌/)).toBeInTheDocument();
    expect(screen.queryByText(/Published Summary/i)).not.toBeInTheDocument();
  });
});
