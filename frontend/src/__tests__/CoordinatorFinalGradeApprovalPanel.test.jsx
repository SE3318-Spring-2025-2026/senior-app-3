import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CoordinatorFinalGradeApprovalPanel from '../pages/CoordinatorFinalGradeApprovalPanel';
import { approveFinalGrades, previewFinalGrades } from '../api/finalGradeService';

jest.mock('../api/finalGradeService', () => ({
  approveFinalGrades: jest.fn(),
  previewFinalGrades: jest.fn(),
}));

const previewFixture = {
  groupId: 'group-1',
  publishCycle: 'cycle-1',
  persistedForApproval: true,
  baseGroupScore: 80,
  students: [
    {
      studentId: 'student-1',
      contributionRatio: 1,
      computedFinalGrade: 80,
    },
  ],
  createdAt: '2026-04-25T12:00:00.000Z',
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/groups/group-1/final-grades/approval']}>
      <Routes>
        <Route
          path="/groups/:groupId/final-grades/approval"
          element={<CoordinatorFinalGradeApprovalPanel />}
        />
      </Routes>
    </MemoryRouter>
  );

describe('CoordinatorFinalGradeApprovalPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewFinalGrades.mockResolvedValue(previewFixture);
    approveFinalGrades.mockResolvedValue({
      success: true,
      groupId: 'group-1',
      publishCycle: 'cycle-1',
      decision: 'approve',
      totalStudents: 1,
      overridesApplied: 0,
      message: 'Successfully approved grades for 1 students',
    });
  });

  it('generates preview and displays student grade rows', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));

    expect(previewFinalGrades).toHaveBeenCalledWith('group-1', {
      persistForApproval: true,
      publishCycle: undefined,
      useLatestRatios: true,
      allowMissingRatios: true,
    });

    expect(await screen.findByText('student-1')).toBeInTheDocument();
    expect(screen.getByText('cycle-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
  });

  it('validates override grade and reason before saving', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
    await screen.findByText('student-1');

    await userEvent.click(screen.getByRole('button', { name: /Override/i }));
    await userEvent.clear(screen.getByLabelText(/Override grade/i));
    await userEvent.type(screen.getByLabelText(/Override grade/i), '101');
    await userEvent.click(screen.getByRole('button', { name: /Save Override/i }));

    expect(await screen.findByText(/between 0 and 100/i)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/Override grade/i));
    await userEvent.type(screen.getByLabelText(/Override grade/i), '85');
    await userEvent.click(screen.getByRole('button', { name: /Save Override/i }));

    expect(await screen.findByText(/Override reason is required/i)).toBeInTheDocument();
  });

  it('submits approval with publishCycle and override entries', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
    await screen.findByText('student-1');

    await userEvent.click(screen.getByRole('button', { name: /Override/i }));
    await userEvent.type(screen.getByLabelText(/Override grade/i), '85');
    await userEvent.type(screen.getByLabelText(/Override reason/i), 'Strong contribution');
    await userEvent.click(screen.getByRole('button', { name: /Save Override/i }));

    expect(await screen.findByText('Strong contribution')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Approval note/i), 'Looks good');
    await userEvent.click(screen.getByRole('button', { name: /^Approve$/i }));

    await waitFor(() => {
      expect(approveFinalGrades).toHaveBeenCalledWith('group-1', {
        publishCycle: 'cycle-1',
        decision: 'approve',
        reason: 'Looks good',
        overrideEntries: [
          {
            studentId: 'student-1',
            originalFinalGrade: 80,
            overriddenFinalGrade: 85,
            overrideReason: 'Strong contribution',
          },
        ],
      });
    });

    expect(await screen.findByText(/Grades Approved/i)).toBeInTheDocument();
  });

  it('submits rejection with publishCycle and reason', async () => {
    approveFinalGrades.mockResolvedValueOnce({
      success: true,
      groupId: 'group-1',
      publishCycle: 'cycle-1',
      decision: 'reject',
      totalStudents: 1,
      overridesApplied: 0,
      message: 'Successfully rejected grades for 1 students',
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
    await screen.findByText('student-1');
    await userEvent.type(screen.getByLabelText(/Reject reason/i), 'Needs recalculation');
    await userEvent.click(screen.getByRole('button', { name: /^Reject$/i }));

    await waitFor(() => {
      expect(approveFinalGrades).toHaveBeenCalledWith('group-1', {
        publishCycle: 'cycle-1',
        decision: 'reject',
        reason: 'Needs recalculation',
        overrideEntries: [],
      });
    });

    expect(await screen.findByText(/Grades Rejected/i)).toBeInTheDocument();
  });

  it('shows coordinator-only messaging for forbidden API responses', async () => {
    previewFinalGrades.mockRejectedValueOnce({
      response: {
        status: 403,
        data: {
          message: 'Forbidden - only the Coordinator role may approve final grades',
        },
      },
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));

    expect(
      await screen.findByText(/only the Coordinator role may approve final grades/i)
    ).toBeInTheDocument();
  });
});
