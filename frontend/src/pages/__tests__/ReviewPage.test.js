import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import ReviewPage from '../ReviewPage';
import { getDeliverableDetails, getComments } from '../../api/reviewAPI';
import useAuthStore from '../../store/authStore';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ deliverableId: 'del-1' }),
}));
jest.mock('../../api/reviewAPI');
jest.mock('../../store/authStore');

jest.mock('../../components/reviews/CommentThread', () =>
  function MockCommentThread({ comments, loading, error }) {
    if (loading) return <div data-testid="ct-loading">Loading comments...</div>;
    if (error) return <div data-testid="ct-error">{error}</div>;
    return <div data-testid="comment-thread-mock">{comments.length} comments</div>;
  }
);
jest.mock('../../components/reviews/AddCommentForm', () =>
  function MockAddCommentForm({ onCommentAdded }) {
    return (
      <div data-testid="add-comment-form-mock">
        <button onClick={onCommentAdded}>TriggerCommentAdded</button>
      </div>
    );
  }
);

const PROF_USER = Object.freeze({ userId: 'u1', username: 'prof1', role: 'professor' });
const COORD_USER = Object.freeze({ userId: 'u2', username: 'coord1', role: 'coordinator' });
const STUDENT_USER = Object.freeze({ userId: 'u3', username: 'student1', role: 'student' });

const mockDeliverable = {
  deliverableId: 'del-1',
  deliverableType: 'proposal',
  groupId: 'group-1',
  sprintId: 'sprint-1',
  status: 'under_review',
  version: 2,
  createdAt: '2024-02-15T10:00:00Z',
  format: 'pdf',
  fileSize: 2 * 1024 * 1024,
  description: 'Test proposal description',
};

const emptyComments = { comments: [], page: 1, totalPages: 1, total: 0 };

function renderWithRouter(component) {
  return render(<BrowserRouter>{component}</BrowserRouter>);
}

describe('ReviewPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) => selector({ user: PROF_USER }));
    getDeliverableDetails.mockResolvedValue(mockDeliverable);
    getComments.mockResolvedValue(emptyComments);
  });

  // ── Deliverable Metadata (criterion 1) ────────────────────────────────────

  describe('Deliverable Metadata', () => {
    test('renders deliverable type', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(screen.getByText('Proposal')).toBeInTheDocument());
    });

    test('renders group ID', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(screen.getByText('group-1')).toBeInTheDocument());
    });

    test('renders sprint ID', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(screen.getByText('sprint-1')).toBeInTheDocument());
    });

    test('renders status badge', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(screen.getByText('under review')).toBeInTheDocument());
    });

    test('renders version number', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument());
    });

    test('renders file format', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => {
        // "Format:" is in a <strong> tag; check the parent <p> contains the value
        expect(screen.getByText('Format:').closest('p')).toHaveTextContent('pdf');
      });
    });

    test('renders file size in MB', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(screen.getByText(/2\.00 MB/)).toBeInTheDocument());
    });

    test('renders description', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByText('Test proposal description')).toBeInTheDocument()
      );
    });

    test('calls getDeliverableDetails with deliverableId on mount', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() => expect(getDeliverableDetails).toHaveBeenCalledWith('del-1'));
    });

    test('calls getComments with deliverableId on mount', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(getComments).toHaveBeenCalledWith('del-1', expect.objectContaining({ page: 1 }))
      );
    });
  });

  // ── Comment Thread (criterion 2) ──────────────────────────────────────────

  describe('Comment Thread', () => {
    test('renders CommentThread after data loads', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByTestId('comment-thread-mock')).toBeInTheDocument()
      );
    });

    test('comment thread refreshes when onCommentAdded fires (criterion 16)', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByTestId('add-comment-form-mock')).toBeInTheDocument()
      );
      getComments.mockClear();
      await user.click(screen.getByRole('button', { name: 'TriggerCommentAdded' }));
      await waitFor(() => expect(getComments).toHaveBeenCalled());
    });
  });

  // ── Loading State (criterion 3) ───────────────────────────────────────────

  describe('Loading State', () => {
    test('shows loading indicator while fetching deliverable', () => {
      getDeliverableDetails.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<ReviewPage />);
      expect(screen.getByText(/Loading deliverable/i)).toBeInTheDocument();
    });

    test('loading indicator disappears after data loads', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.queryByText(/Loading deliverable/i)).not.toBeInTheDocument()
      );
    });
  });

  // ── Error State (criterion 4) ─────────────────────────────────────────────

  describe('Error State', () => {
    test('shows error heading when API call fails', async () => {
      getDeliverableDetails.mockRejectedValue({
        response: { status: 500, data: { message: 'Internal server error' } },
      });
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByText('Error Loading Deliverable')).toBeInTheDocument()
      );
    });

    test('shows API error message in error state', async () => {
      getDeliverableDetails.mockRejectedValue({
        response: { status: 500, data: { message: 'Internal server error' } },
      });
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByText('Internal server error')).toBeInTheDocument()
      );
    });

    test('404 response shows Deliverable not found', async () => {
      getDeliverableDetails.mockRejectedValue({
        response: { status: 404, data: { message: 'Not found' } },
      });
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByText('Deliverable not found')).toBeInTheDocument()
      );
    });

    test('403 response shows permission error', async () => {
      getDeliverableDetails.mockRejectedValue({
        response: { status: 403, data: { message: 'Forbidden' } },
      });
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument()
      );
    });
  });

  // ── Role-based Form Rendering (criterion 28) ──────────────────────────────

  describe('Role-based AddCommentForm rendering', () => {
    test('AddCommentForm rendered for professor', async () => {
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByTestId('add-comment-form-mock')).toBeInTheDocument()
      );
    });

    test('AddCommentForm rendered for coordinator', async () => {
      useAuthStore.mockImplementation((selector) => selector({ user: COORD_USER }));
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByTestId('add-comment-form-mock')).toBeInTheDocument()
      );
    });

    test('AddCommentForm NOT rendered for student role', async () => {
      useAuthStore.mockImplementation((selector) => selector({ user: STUDENT_USER }));
      renderWithRouter(<ReviewPage />);
      await waitFor(() =>
        expect(screen.getByTestId('comment-thread-mock')).toBeInTheDocument()
      );
      expect(screen.queryByTestId('add-comment-form-mock')).not.toBeInTheDocument();
    });
  });
});
