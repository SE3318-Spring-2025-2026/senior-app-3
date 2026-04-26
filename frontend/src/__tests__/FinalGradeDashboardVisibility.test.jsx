import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentFinalGradesPage from '../pages/StudentFinalGradesPage';
import CommitteeFinalResults from '../pages/CommitteeFinalResults';
import ProtectedRoute from '../components/ProtectedRoute';
import useAuthStore from '../store/authStore';
import { getCommitteeFinalResults, getMyFinalGrades } from '../api/finalGradeService';

jest.mock('../store/authStore');

jest.mock('../api/finalGradeService', () => ({
  getCommitteeFinalResults: jest.fn(),
  getMyFinalGrades: jest.fn(),
}));

const Unauthorized = () => <div>Unauthorized</div>;
const LoginPage = () => <div>Login Page</div>;

const renderStudentPage = () =>
  render(
    <MemoryRouter>
      <StudentFinalGradesPage />
    </MemoryRouter>
  );

const renderCommitteePage = () =>
  render(
    <MemoryRouter initialEntries={['/committees/committee-1/final-results']}>
      <Routes>
        <Route path="/committees/:committeeId/final-results" element={<CommitteeFinalResults />} />
      </Routes>
    </MemoryRouter>
  );

const renderProtectedRoutes = (initialEntry) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/me/final-grades"
          element={<ProtectedRoute component={StudentFinalGradesPage} requiredRoles={['student']} />}
        />
        <Route
          path="/committees/:committeeId/final-results"
          element={
            <ProtectedRoute component={CommitteeFinalResults} requiredRoles={['committee_member', 'admin']} />
          }
        />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
      </Routes>
    </MemoryRouter>
  );

describe('Final grade dashboard visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'student-1', studentId: 'student-1', role: 'student' },
    });
  });

  it('shows a student only their own published final grades', async () => {
    getMyFinalGrades.mockResolvedValue([
      {
        studentId: 'student-1',
        groupId: 'group-alpha',
        finalGrade: 91.25,
        baseGroupScore: 95,
        individualRatio: 0.9605,
        status: 'published',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      {
        studentId: 'student-1',
        groupId: 'draft-only',
        finalGrade: 72,
        status: 'draft',
        createdAt: '2026-04-21T10:00:00.000Z',
      },
      {
        studentId: 'student-2',
        groupId: 'group-other',
        finalGrade: 99,
        status: 'published',
        createdAt: '2026-04-22T10:00:00.000Z',
      },
    ]);

    renderStudentPage();

    expect(await screen.findByRole('heading', { name: /Published grade history/i })).toBeInTheDocument();
    expect(screen.getAllByText('group-alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/91[.,]25/).length).toBeGreaterThan(0);

    expect(screen.queryByText('draft-only')).not.toBeInTheDocument();
    expect(screen.queryByText('72')).not.toBeInTheDocument();
    expect(screen.queryByText('group-other')).not.toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(screen.queryByText(/Final grades are not published yet/i)).not.toBeInTheDocument();
  });

  it('shows the student empty state when no self published records are visible', async () => {
    getMyFinalGrades.mockResolvedValue([
      {
        studentId: 'student-1',
        groupId: 'group-alpha',
        finalGrade: 88,
        status: 'preview',
      },
      {
        studentId: 'student-2',
        groupId: 'group-other',
        finalGrade: 93,
        status: 'published',
      },
    ]);

    renderStudentPage();

    expect(await screen.findByRole('heading', { name: /Final grades are not published yet/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Published grade history/i })).not.toBeInTheDocument();
    expect(screen.queryByText('group-alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('group-other')).not.toBeInTheDocument();
  });

  it('shows committee members published group outcomes without draft preview data', async () => {
    getCommitteeFinalResults.mockResolvedValue({
      committeeId: 'committee-1',
      publishedAt: '2026-04-25T08:30:00.000Z',
      finalGrades: [
        {
          studentId: 'student-1',
          studentName: 'Ada Student',
          groupName: 'Group Alpha',
          finalGrade: 90,
          baseGroupScore: 92,
          individualRatio: 0.978,
          status: 'published',
          publishedAt: '2026-04-25T08:30:00.000Z',
        },
        {
          studentId: 'student-2',
          studentName: 'Grace Student',
          groupName: 'Group Beta',
          finalGrade: 87,
          baseGroupScore: 89,
          individualRatio: 0.9775,
          status: 'published',
          publishedAt: '2026-04-25T08:31:00.000Z',
        },
        {
          studentId: 'student-3',
          studentName: 'Draft Preview Student',
          groupName: 'Preview Group',
          finalGrade: 100,
          baseGroupScore: 100,
          individualRatio: 1,
          status: 'draft',
        },
      ],
    });

    renderCommitteePage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Ada Student')).toBeInTheDocument();
    expect(within(table).getByText('Grace Student')).toBeInTheDocument();
    expect(within(table).getByText('Group Alpha')).toBeInTheDocument();
    expect(within(table).getByText('Group Beta')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    expect(screen.queryByText('Draft Preview Student')).not.toBeInTheDocument();
    expect(screen.queryByText('Preview Group')).not.toBeInTheDocument();
    expect(screen.queryByText(/^draft$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('redirects wrong roles away from student and committee final grade dashboards', async () => {
    useAuthStore.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'committee-user', role: 'committee_member' },
    });

    const { unmount } = renderProtectedRoutes('/me/final-grades');
    expect(await screen.findByText('Unauthorized')).toBeInTheDocument();
    expect(getMyFinalGrades).not.toHaveBeenCalled();
    unmount();

    useAuthStore.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'student-1', role: 'student' },
    });

    renderProtectedRoutes('/committees/committee-1/final-results');
    await waitFor(() => {
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
    expect(getCommitteeFinalResults).not.toHaveBeenCalled();
  });
});
