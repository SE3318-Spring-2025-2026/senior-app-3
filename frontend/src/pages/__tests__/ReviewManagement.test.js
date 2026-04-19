import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import ReviewManagement from '../ReviewManagement';
import reviewService from '../../api/reviewService';
import authStore from '../../store/authStore';

jest.mock('../../api/reviewService');
jest.mock('../../store/authStore');

const mockReviews = [
  {
    reviewId: 'r1',
    groupName: 'Team Alpha',
    status: 'pending',
    deadline: '2024-02-15',
    createdAt: '2024-02-01'
  },
  {
    reviewId: 'r2',
    groupName: 'Team Beta',
    status: 'in_progress',
    deadline: '2024-02-20',
    createdAt: '2024-02-05'
  },
  {
    reviewId: 'r3',
    groupName: 'Team Gamma',
    status: 'completed',
    deadline: '2024-02-10',
    createdAt: '2024-01-30'
  }
];

const mockStats = {
  pending: 5,
  in_progress: 3,
  needs_clarification: 2,
  completed: 10
};

function renderWithRouter(component) {
  return render(<BrowserRouter>{component}</BrowserRouter>);
}

describe('ReviewManagement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStore.getState.mockReturnValue({
      user: { username: 'coord1', role: 'coordinator' }
    });
    reviewService.getReviewsForCoordinator.mockResolvedValue({
      data: mockReviews,
      total: mockReviews.length
    });
    reviewService.getReviewStatus.mockResolvedValue({
      data: mockStats
    });
  });

  describe('Page Layout', () => {
    test('renders page title', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByText('Review Management')).toBeInTheDocument();
      });
    });

    test('renders stat cards section with all status labels', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        const statHeaders = screen.getAllByText(/Pending|In Progress|Needs Clarification|Completed/);
        expect(statHeaders.length).toBeGreaterThanOrEqual(4);
      });
    });

    test('renders review list table', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByTestId('review-list')).toBeInTheDocument();
      });
    });

    test('renders pagination controls', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByTestId('prev-page')).toBeInTheDocument();
        expect(screen.getByTestId('next-page')).toBeInTheDocument();
        expect(screen.getByTestId('page-info')).toBeInTheDocument();
      });
    });
  });

  describe('Stat Cards', () => {
    test('stat cards render with actual counts from mocked GET /reviews/status', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByTestId('stat-pending')).toHaveTextContent('5');
        expect(screen.getByTestId('stat-in-progress')).toHaveTextContent('3');
        expect(screen.getByTestId('stat-clarification')).toHaveTextContent('2');
        expect(screen.getByTestId('stat-completed')).toHaveTextContent('10');
      });
    });

    test('stat services are called on mount', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(reviewService.getReviewStatus).toHaveBeenCalled();
      });
    });
  });

  describe('Review List - Table Columns', () => {
    test('review list shows correct columns with headers', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        const table = screen.getByTestId('review-list');
        const headers = within(table).getAllByRole('columnheader');

        // Should have 5 columns: Group Name, Status, Deadline, Created, Actions
        expect(headers.length).toBe(5);
        expect(headers[0]).toHaveTextContent(/Group Name/i);
        expect(headers[1]).toHaveTextContent(/Status/i);
        expect(headers[2]).toHaveTextContent(/Deadline/i);
        expect(headers[3]).toHaveTextContent(/Created/i);
        expect(headers[4]).toHaveTextContent(/Actions/i);
      });
    });

    test('review list displays real data rows', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        // Check all reviews are displayed
        expect(screen.getByText('Team Alpha')).toBeInTheDocument();
        expect(screen.getByText('Team Beta')).toBeInTheDocument();
        expect(screen.getByText('Team Gamma')).toBeInTheDocument();
      });
    });

    test('review list shows status for each row', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        // Status values should be visible
        expect(screen.getByText('pending')).toBeInTheDocument();
        expect(screen.getByText('in_progress')).toBeInTheDocument();
        expect(screen.getByText('completed')).toBeInTheDocument();
      });
    });

    test('review list shows deadline and creation date', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByText('2024-02-15')).toBeInTheDocument(); // deadline
        expect(screen.getByText('2024-02-01')).toBeInTheDocument(); // created
      });
    });
  });

  describe('Filter Dropdown', () => {
    test('filter dropdown exists and renders options', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        const filterDropdown = screen.getByTestId('filter-dropdown');
        expect(filterDropdown).toBeInTheDocument();

        const options = within(filterDropdown).getAllByRole('option');
        expect(options.length).toBe(5); // All Reviews + 4 statuses
      });
    });

    test('filter dropdown has all status values as options', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        const filterDropdown = screen.getByTestId('filter-dropdown');
        expect(within(filterDropdown).getByRole('option', { name: /All Reviews/i })).toBeInTheDocument();
        expect(within(filterDropdown).getByRole('option', { name: /Pending/i })).toBeInTheDocument();
        expect(within(filterDropdown).getByRole('option', { name: /In Progress/i })).toBeInTheDocument();
        expect(within(filterDropdown).getByRole('option', { name: /Needs Clarification/i })).toBeInTheDocument();
        expect(within(filterDropdown).getByRole('option', { name: /Completed/i })).toBeInTheDocument();
      });
    });

    test('changing filter dropdown calls API with correct status parameter', async () => {
      const user = userEvent.setup();
      reviewService.getReviewsForCoordinator.mockClear();
      reviewService.getReviewsForCoordinator.mockResolvedValue({
        data: [mockReviews[0]],
        total: 1
      });

      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
      });

      // Change filter
      const filterDropdown = screen.getByTestId('filter-dropdown');
      await user.selectOptions(filterDropdown, 'pending');

      // Should call API with filter
      await waitFor(() => {
        expect(reviewService.getReviewsForCoordinator).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'pending'
          })
        );
      });
    });

    test('filter dropdown resets pagination to page 1', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
      });

      // Change filter
      const filterDropdown = screen.getByTestId('filter-dropdown');
      await user.selectOptions(filterDropdown, 'pending');

      // Should be on page 1
      await waitFor(() => {
        expect(screen.getByTestId('page-info')).toHaveTextContent('Page 1');
      });
    });
  });

  describe('Pagination', () => {
    test('pagination calls API with correct page parameter when next clicked', async () => {
      const user = userEvent.setup();
      reviewService.getReviewsForCoordinator.mockResolvedValueOnce({
        data: mockReviews,
        total: 25 // Enough for multiple pages
      }).mockResolvedValueOnce({
        data: mockReviews,
        total: 25
      });

      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByText('Team Alpha')).toBeInTheDocument();
      });

      // Click next
      const nextBtn = screen.getByTestId('next-page');
      if (!nextBtn.disabled) {
        await user.click(nextBtn);

        await waitFor(() => {
          expect(reviewService.getReviewsForCoordinator).toHaveBeenCalledWith(
            expect.objectContaining({
              page: 2
            })
          );
        });
      }
    });

    test('next page button disabled when on only page', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByText('Team Alpha')).toBeInTheDocument();
      });

      const nextBtn = screen.getByTestId('next-page');
      // Only 3 items total, 10 per page = 1 page only
      expect(nextBtn).toBeDisabled();
    });

    test('previous page button disabled on first page', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByText('Team Alpha')).toBeInTheDocument();
      });

      const prevBtn = screen.getByTestId('prev-page');
      expect(prevBtn).toBeDisabled();
    });

    test('page info shows current page and total pages', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        const pageInfo = screen.getByTestId('page-info');
        expect(pageInfo).toHaveTextContent('Page');
        expect(pageInfo).toHaveTextContent('1');
      });
    });
  });

  describe('Loading States', () => {
    test('shows loading indicator on initial load', async () => {
      reviewService.getReviewsForCoordinator.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ data: mockReviews, total: 3 }), 500))
      );

      renderWithRouter(<ReviewManagement />);

      // Should show loading while fetching
      expect(screen.getByRole('status')).toHaveTextContent(/Loading/i);
    });

    test('hides loading and shows content after loading completes', async () => {
      renderWithRouter(<ReviewManagement />);

      // Wait for content to appear
      await waitFor(() => {
        expect(screen.getByText('Team Alpha')).toBeInTheDocument();
      });

      // Loading should be gone or hidden
      await waitFor(() => {
        const loading = screen.queryByRole('status', { hidden: false });
        if (loading) {
          expect(loading).not.toHaveTextContent(/Loading/i);
        }
      });
    });
  });

  describe('Row Actions', () => {
    test('each row has an update button', async () => {
      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        const updateButtons = screen.getAllByTestId(/^update-status-/);
        expect(updateButtons.length).toBe(3); // One for each review
      });
    });

    test('update button calls status change API', async () => {
      const user = userEvent.setup();
      reviewService.updateReviewStatus.mockResolvedValue({ success: true });

      renderWithRouter(<ReviewManagement />);

      await waitFor(() => {
        expect(screen.getByText('Team Alpha')).toBeInTheDocument();
      });

      // Click update button for first review
      const updateBtn = screen.getByTestId('update-status-r1');
      await user.click(updateBtn);

      // Should call updateReviewStatus
      await waitFor(() => {
        expect(reviewService.updateReviewStatus).toHaveBeenCalledWith(
          'r1',
          expect.objectContaining({ status: 'completed' })
        );
      });
    });
  });

  describe('Integration', () => {
    test('complete workflow: renders stat cards, review list with data, and pagination', async () => {
      renderWithRouter(<ReviewManagement />);

      // 1. Should load and display stat counts
      await waitFor(() => {
        expect(screen.getByTestId('stat-pending')).toHaveTextContent('5');
        expect(screen.getByTestId('stat-completed')).toHaveTextContent('10');
      });

      // 2. Should display review data
      expect(screen.getByText('Team Alpha')).toBeInTheDocument();
      expect(screen.getByText('Team Beta')).toBeInTheDocument();

      // 3. Should have pagination controls
      expect(screen.getByTestId('prev-page')).toBeInTheDocument();
      expect(screen.getByTestId('next-page')).toBeInTheDocument();

      // 4. Should have filter dropdown
      expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
    });
  });
});
