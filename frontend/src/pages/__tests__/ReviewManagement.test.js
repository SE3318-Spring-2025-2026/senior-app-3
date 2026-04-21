import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import ReviewManagement from '../ReviewManagement';
import { getReviews, getReviewStatus } from '../../api/reviewAPI';
import useAuthStore from '../../store/authStore';

// Stable user objects — defined outside beforeEach so the same reference is
// returned on every render. Without this, the inline object in mockImplementation
// changes identity each call, causing useEffect([user]) to fire every render.
const COORD_USER = Object.freeze({ username: 'coord1', role: 'coordinator' });
const ADMIN_USER = Object.freeze({ username: 'admin1', role: 'admin' });
const STUDENT_USER = Object.freeze({ username: 'student1', role: 'student' });

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('../../api/reviewAPI');
jest.mock('../../store/authStore');
// Mock the child form so we control onSuccess/onCancel directly
jest.mock('../../components/reviews/ReviewAssignmentForm', () =>
  function MockAssignmentForm({ onSuccess, onCancel }) {
    return (
      <div role="dialog" aria-modal="true" data-testid="assignment-form-mock">
        <button onClick={() => onSuccess({ success: true })}>MockSubmit</button>
        <button onClick={onCancel}>MockCancel</button>
      </div>
    );
  }
);

const mockReviews = [
  {
    deliverableId: 'del-1',
    deliverableType: 'proposal',
    groupId: 'group-1',
    sprintId: 'sprint-1',
    reviewStatus: 'pending',
    deadline: '2024-02-15',
    commentCount: 0,
    clarificationsRemaining: 0,
    deliverableStatus: 'in_review',
  },
  {
    deliverableId: 'del-2',
    deliverableType: 'interim_report',
    groupId: 'group-2',
    sprintId: 'sprint-2',
    reviewStatus: 'in_progress',
    deadline: '2024-02-20',
    commentCount: 1,
    clarificationsRemaining: 0,
    deliverableStatus: 'in_review',
  },
  {
    deliverableId: 'del-3',
    deliverableType: 'final_report',
    groupId: 'group-3',
    sprintId: 'sprint-3',
    reviewStatus: 'completed',
    deadline: '2024-02-10',
    commentCount: 5,
    clarificationsRemaining: 0,
    deliverableStatus: 'in_review',
  },
];

// A review that triggers the Assign button (accepted deliverable, no review yet)
const mockAssignableReview = {
  deliverableId: 'del-assign',
  deliverableType: 'demo',
  groupId: 'group-assign',
  sprintId: 'sprint-assign',
  deliverableStatus: 'accepted',
  deadline: '2024-03-01',
  commentCount: 0,
  clarificationsRemaining: 0,
};

const mockStats = {
  pending: 5,
  in_progress: 3,
  needs_clarification: 2,
  completed: 10,
};

function renderWithRouter(component) {
  return render(<BrowserRouter>{component}</BrowserRouter>);
}

describe('ReviewManagement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
    useAuthStore.mockImplementation((selector) => selector({ user: COORD_USER }));
    getReviewStatus.mockResolvedValue(mockStats);
    getReviews.mockResolvedValue({
      reviews: mockReviews,
      page: 1,
      totalPages: 1,
      total: mockReviews.length,
    });
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  describe('Authorization', () => {
    test('non-coordinator user is redirected to /dashboard', async () => {
      useAuthStore.mockImplementation((selector) => selector({ user: STUDENT_USER }));
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });

    test('null user is redirected to /dashboard', async () => {
      useAuthStore.mockImplementation((selector) => selector({ user: null })); // null is already stable
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });

    test('coordinator can access the page', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.getByText('Review Management')).toBeInTheDocument();
      });
    });

    test('admin can access the page', async () => {
      useAuthStore.mockImplementation((selector) => selector({ user: ADMIN_USER }));
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.getByText('Review Management')).toBeInTheDocument();
      });
    });
  });

  // ── Stat Cards ────────────────────────────────────────────────────────────

  describe('Stat Cards', () => {
    test('stat cards render with correct counts from GET /reviews/status', async () => {
      const { container } = renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        const statsEl = container.querySelector('.review-stats-container');
        const cards = Array.from(statsEl.querySelectorAll('.stat-card'));
        expect(cards.find((c) => c.textContent.includes('Pending'))).toHaveTextContent('5');
        expect(cards.find((c) => c.textContent.includes('In Progress'))).toHaveTextContent('3');
        expect(cards.find((c) => c.textContent.includes('Clarification'))).toHaveTextContent('2');
        expect(cards.find((c) => c.textContent.includes('Completed'))).toHaveTextContent('10');
      });
    });

    test('getReviewStatus is called on mount', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => expect(getReviewStatus).toHaveBeenCalled());
    });
  });

  // ── Review List ───────────────────────────────────────────────────────────

  describe('Review List', () => {
    test('renders the review list table', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    });

    test('review list shows correct columns with data from GET /reviews', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        const headers = screen.getAllByRole('columnheader');
        expect(headers).toHaveLength(9);
        expect(headers[0]).toHaveTextContent(/Deliverable ID/i);
        expect(headers[1]).toHaveTextContent(/Type/i);
        expect(headers[2]).toHaveTextContent(/Group ID/i);
        expect(headers[8]).toHaveTextContent(/Action/i);
      });
    });

    test('review list displays data rows from mocked GET /reviews', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.getByText('del-1')).toBeInTheDocument();
        expect(screen.getByText('Proposal')).toBeInTheDocument();
        expect(screen.getByText('group-1')).toBeInTheDocument();
      });
    });
  });

  // ── Filter Dropdown ───────────────────────────────────────────────────────

  describe('Filter Dropdown', () => {
    test('renders with all 5 status options', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        const filter = screen.getByRole('combobox');
        expect(within(filter).getAllByRole('option')).toHaveLength(5);
      });
    });

    test('has All Reviews, Pending, In Progress, Needs Clarification, Completed options', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        const filter = screen.getByRole('combobox');
        expect(within(filter).getByRole('option', { name: /All Reviews/i })).toBeInTheDocument();
        expect(within(filter).getByRole('option', { name: /^Pending$/i })).toBeInTheDocument();
        expect(within(filter).getByRole('option', { name: /In Progress/i })).toBeInTheDocument();
        expect(within(filter).getByRole('option', { name: /Needs Clarification/i })).toBeInTheDocument();
        expect(within(filter).getByRole('option', { name: /^Completed$/i })).toBeInTheDocument();
      });
    });

    test('changing filter calls GET /reviews with correct status parameter', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
      await user.selectOptions(screen.getByRole('combobox'), 'pending');
      await waitFor(() => {
        expect(getReviews).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
      });
    });

    test('changing filter resets pagination to page 1', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
      await user.selectOptions(screen.getByRole('combobox'), 'in_progress');
      await waitFor(() => {
        expect(getReviews).toHaveBeenCalledWith(
          expect.objectContaining({ page: 1, status: 'in_progress' })
        );
      });
    });
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  describe('Pagination', () => {
    beforeEach(() => {
      getReviews.mockResolvedValue({ reviews: mockReviews, page: 1, totalPages: 3, total: 50 });
    });

    test('next page button fetches page 2 from GET /reviews', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewManagement />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
      );
      getReviews.mockClear();
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => {
        expect(getReviews).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
      });
    });

    test('previous page button is disabled on first page', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
      });
    });

    test('next page button is disabled on last page', async () => {
      getReviews.mockResolvedValue({ reviews: mockReviews, page: 3, totalPages: 3, total: 50 });
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
      });
    });

    test('page info shows current page and total pages', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
      });
    });
  });

  // ── Assignment Form ───────────────────────────────────────────────────────

  describe('Assignment Form', () => {
    test('clicking Assign on an accepted deliverable opens the assignment form', async () => {
      const user = userEvent.setup();
      getReviews.mockResolvedValue({
        reviews: [mockAssignableReview],
        page: 1,
        totalPages: 1,
        total: 1,
      });
      renderWithRouter(<ReviewManagement />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: 'Assign' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    test('after successful assignment, review list is refreshed', async () => {
      const user = userEvent.setup();
      getReviews.mockResolvedValue({
        reviews: [mockAssignableReview],
        page: 1,
        totalPages: 1,
        total: 1,
      });
      renderWithRouter(<ReviewManagement />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument()
      );
      const callsBefore = getReviews.mock.calls.length;
      await user.click(screen.getByRole('button', { name: 'Assign' }));
      await user.click(screen.getByRole('button', { name: 'MockSubmit' }));
      await waitFor(() => {
        expect(getReviews.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });
  });

  // ── Loading States ────────────────────────────────────────────────────────

  describe('Loading States', () => {
    test('shows loading indicator while fetching data', () => {
      getReviews.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<ReviewManagement />);
      expect(screen.getByText(/Loading reviews/i)).toBeInTheDocument();
    });

    test('loading indicator is hidden after data is fetched', async () => {
      renderWithRouter(<ReviewManagement />);
      await waitFor(() => {
        expect(screen.queryByText(/Loading reviews/i)).not.toBeInTheDocument();
      });
    });
  });
});
