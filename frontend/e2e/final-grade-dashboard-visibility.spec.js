const { test, expect } = require('@playwright/test');

const AUTH_STORAGE_KEY = 'auth-storage';

const setAuth = async (page, user) => {
  await page.addInitScript(([storageKey, authUser]) => {
    const authState = {
      state: {
        user: authUser,
        accessToken: 'e2e-access-token',
        refreshToken: 'e2e-refresh-token',
        isAuthenticated: true,
        requiresPasswordChange: false,
      },
      version: 0,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(authState));
  }, [AUTH_STORAGE_KEY, user]);
};

test.describe('Issue #263 final grade dashboard visibility', () => {
  test('student sees only self published grades in browser flow', async ({ page }) => {
    await setAuth(page, { id: 'student-1', userId: 'student-1', studentId: 'student-1', role: 'student' });

    await page.route('**/api/v1/me/final-grades**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          studentId: 'student-1',
          grades: [
            {
              finalGradeId: 'fg_self_1',
              studentId: 'student-1',
              groupId: 'group-alpha',
              finalGrade: 92,
              baseGroupScore: 95,
              individualRatio: 0.9684,
              status: 'published',
              publishedAt: '2026-04-26T10:00:00.000Z',
            },
            {
              finalGradeId: 'fg_self_draft',
              studentId: 'student-1',
              groupId: 'group-alpha',
              finalGrade: 40,
              status: 'draft',
            },
          ],
        }),
      });
    });

    await page.goto('/me/final-grades');

    await expect(page.getByTestId('student-final-grades-page')).toBeVisible();
    await expect(page.getByTestId('student-final-grades-table')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'group-alpha' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '92' })).toBeVisible();
    await expect(page.locator('[data-testid^="student-grade-row-"]')).toHaveCount(1);
    await expect(page.getByText('group-beta')).toHaveCount(0);
    await expect(page.getByText('100')).toHaveCount(0);
    await expect(page.getByText('40')).toHaveCount(0);
  });

  test('committee sees published outcomes without draft preview leaks', async ({ page }) => {
    await setAuth(page, { id: 'committee-1', userId: 'committee-1', role: 'committee_member' });

    await page.route('**/api/v1/committees/committee-42/final-results**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          committeeId: 'committee-42',
          finalGrades: [
            {
              studentId: 'student-1',
              studentName: 'Ada Student',
              groupName: 'Group Alpha',
              finalGrade: 90,
              baseGroupScore: 92,
              individualRatio: 0.978,
              status: 'published',
              publishedAt: '2026-04-26T10:00:00.000Z',
            },
            {
              studentId: 'student-2',
              studentName: 'Grace Student',
              groupName: 'Group Beta',
              finalGrade: 88,
              baseGroupScore: 90,
              individualRatio: 0.9777,
              status: 'published',
              publishedAt: '2026-04-26T10:01:00.000Z',
            },
            {
              studentId: 'student-3',
              studentName: 'Draft Preview Student',
              groupName: 'Preview Group',
              finalGrade: 100,
              status: 'draft',
            },
          ],
        }),
      });
    });

    await page.goto('/committees/committee-42/final-results');

    await expect(page.getByTestId('committee-final-results-page')).toBeVisible();
    await expect(page.getByTestId('committee-final-results-table')).toBeVisible();
    await expect(page.getByText('Ada Student')).toBeVisible();
    await expect(page.getByText('Grace Student')).toBeVisible();
    await expect(page.locator('[data-testid^="committee-grade-row-"]')).toHaveCount(2);
    await expect(page.getByText('Draft Preview Student')).toHaveCount(0);
    await expect(page.getByText('Preview Group')).toHaveCount(0);
    await expect(page.getByTestId('committee-grade-status')).toHaveCount(2);
    await expect(page.getByTestId('committee-grade-status').first()).toHaveText(/published/i);
  });

  test("student cannot access committee's final result route", async ({ page }) => {
    await setAuth(page, { id: 'student-1', userId: 'student-1', studentId: 'student-1', role: 'student' });

    await page.goto('/committees/committee-42/final-results');

    await expect(page).toHaveURL(/\/unauthorized$/);
    await expect(page.getByTestId('unauthorized-page')).toBeVisible();
  });
});
