import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import StudentFinalGradesPage from '../pages/StudentFinalGradesPage';

jest.mock('../api/finalGradeService', () => ({
  getMyFinalGrades: jest.fn(),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('shows published grades when API returns published records', async () => {
  const { getMyFinalGrades } = require('../api/finalGradeService');
  const published = [
    { studentId: 's1', groupId: 'g1', status: 'published', finalGrade: 85, createdAt: new Date().toISOString() },
  ];
  getMyFinalGrades.mockResolvedValueOnce(published);

  render(<StudentFinalGradesPage />);

  await waitFor(() => screen.getByTestId('student-final-grade-summary'));
  expect(screen.getByTestId('student-final-grade-summary')).toBeTruthy();
});

test('shows access denied on 403 error', async () => {
  const { getMyFinalGrades } = require('../api/finalGradeService');
  getMyFinalGrades.mockRejectedValueOnce({ response: { status: 403 } });

  render(<StudentFinalGradesPage />);

  await waitFor(() => screen.getByText(/Access denied/i));
});

test('shows empty state when grades not published (404)', async () => {
  const { getMyFinalGrades } = require('../api/finalGradeService');
  getMyFinalGrades.mockRejectedValueOnce({ response: { status: 404 } });

  render(<StudentFinalGradesPage />);

  await waitFor(() => screen.getByTestId('student-final-grades-empty'));
});
