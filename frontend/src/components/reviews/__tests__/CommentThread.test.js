import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CommentThread from '../CommentThread';
import { editComment, resolveComment, addReply } from '../../../api/reviewAPI';
import useAuthStore from '../../../store/authStore';

jest.mock('../../../api/reviewAPI');
jest.mock('../../../store/authStore');
// Render markdown as plain text so RTL text queries work predictably
jest.mock('../../../utils/markdownRenderer', () => ({
  renderMarkdown: (text) => text || '',
  default: (text) => text || '',
}));

// PROF_USER is author of c1 and c3 (userId matches authorId)
const PROF_USER = Object.freeze({ userId: 'user-1', username: 'prof1', role: 'professor' });
const COORD_USER = Object.freeze({ userId: 'user-coord', username: 'coord1', role: 'coordinator' });
const STUDENT_USER = Object.freeze({ userId: 'user-student', username: 'student1', role: 'student' });
// Different professor — not author of any mock comment
const OTHER_PROF = Object.freeze({ userId: 'user-other', username: 'other_prof', role: 'professor' });

const mockComments = [
  {
    commentId: 'c1',
    content: 'Great proposal!',
    commentType: 'praise',
    status: 'open',
    authorId: 'user-1',
    authorName: 'Prof. Smith',
    createdAt: '2024-02-15T10:00:00Z',
    needsResponse: false,
    replies: [],
  },
  {
    commentId: 'c2',
    content: 'Please clarify section 3',
    commentType: 'clarification_required',
    status: 'open',
    authorId: 'user-2',
    authorName: 'Prof. Jones',
    createdAt: '2024-02-15T11:00:00Z',
    needsResponse: true,
    replies: [
      {
        replyId: 'r1',
        content: 'Here is the clarification',
        authorId: 'user-student',
        authorName: 'Student A',
        createdAt: '2024-02-15T12:00:00Z',
      },
    ],
  },
  {
    commentId: 'c3',
    content: 'Well done on this section',
    commentType: 'general',
    status: 'resolved',
    authorId: 'user-1',
    authorName: 'Prof. Smith',
    createdAt: '2024-02-15T13:00:00Z',
    needsResponse: false,
    replies: [],
  },
];

describe('CommentThread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) => selector({ user: PROF_USER }));
    editComment.mockResolvedValue({ success: true });
    resolveComment.mockResolvedValue({ success: true });
    addReply.mockResolvedValue({ replyId: 'r-new' });
  });

  // ── Comment List (criteria 5, 6, 7) ──────────────────────────────────────

  describe('Comment List', () => {
    test('all comments listed with correct content (criterion 5)', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText('Great proposal!')).toBeInTheDocument();
      expect(screen.getByText('Please clarify section 3')).toBeInTheDocument();
      expect(screen.getByText('Well done on this section')).toBeInTheDocument();
    });

    test('author names are shown for each comment', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getAllByText('Prof. Smith')).toHaveLength(2); // c1 and c3
      expect(screen.getByText('Prof. Jones')).toBeInTheDocument();
    });

    test('commentType badge shown for each comment (criterion 6)', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText('praise')).toBeInTheDocument();
      expect(screen.getByText('clarification required')).toBeInTheDocument();
      expect(screen.getByText('general')).toBeInTheDocument();
    });

    test('status badge shown for each comment (criterion 7)', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getAllByText('open')).toHaveLength(2);
      expect(screen.getByText('resolved')).toBeInTheDocument();
    });

    test('empty state shown when comments array is empty', () => {
      render(<CommentThread comments={[]} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText(/No comments yet/i)).toBeInTheDocument();
    });
  });

  // ── needsResponse Highlighting (criterion 8) ──────────────────────────────

  describe('needsResponse Highlighting', () => {
    test('needsResponse+open comment has orange border class (criterion 8)', () => {
      const { container } = render(
        <CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />
      );
      const items = container.querySelectorAll('.comment-item');
      const c2 = Array.from(items).find((el) =>
        el.textContent.includes('Please clarify section 3')
      );
      expect(c2).toHaveClass('border-orange-400');
    });

    test('non-needsResponse comment does NOT have orange border', () => {
      const { container } = render(
        <CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />
      );
      const items = container.querySelectorAll('.comment-item');
      const c1 = Array.from(items).find((el) =>
        el.textContent.includes('Great proposal!')
      );
      expect(c1).not.toHaveClass('border-orange-400');
    });

    test('Needs Response badge shown for needsResponse+open comment', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText(/Needs Response/i)).toBeInTheDocument();
    });

    test('needsResponse+resolved comment does NOT show Needs Response badge', () => {
      const resolvedNeedsResponse = [
        { ...mockComments[1], status: 'resolved', commentId: 'cx' },
      ];
      render(<CommentThread comments={resolvedNeedsResponse} onCommentUpdated={jest.fn()} />);
      expect(screen.queryByText(/Needs Response/i)).not.toBeInTheDocument();
    });
  });

  // ── Replies (criterion 9) ─────────────────────────────────────────────────

  describe('Replies', () => {
    test('replies shown nested under parent comment (criterion 9)', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText('Here is the clarification')).toBeInTheDocument();
    });

    test('reply author name shown', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText('Student A')).toBeInTheDocument();
    });

    test('reply count shown in Replies heading', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(screen.getByText('Replies (1)')).toBeInTheDocument();
    });
  });

  // ── Filter by Status (criterion 10) ───────────────────────────────────────

  describe('Filter by Status', () => {
    test('open filter shows only open comments (criterion 10)', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      await user.selectOptions(
        screen.getByRole('combobox', { name: /filter comments by status/i }),
        'open'
      );
      expect(screen.getByText('Great proposal!')).toBeInTheDocument();
      expect(screen.getByText('Please clarify section 3')).toBeInTheDocument();
      expect(screen.queryByText('Well done on this section')).not.toBeInTheDocument();
    });

    test('resolved filter shows only resolved comments', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      await user.selectOptions(
        screen.getByRole('combobox', { name: /filter comments by status/i }),
        'resolved'
      );
      expect(screen.queryByText('Great proposal!')).not.toBeInTheDocument();
      expect(screen.getByText('Well done on this section')).toBeInTheDocument();
    });

    test('all filter restores all comments', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      const filter = screen.getByRole('combobox', { name: /filter comments by status/i });
      await user.selectOptions(filter, 'resolved');
      await user.selectOptions(filter, 'all');
      expect(screen.getByText('Great proposal!')).toBeInTheDocument();
      expect(screen.getByText('Well done on this section')).toBeInTheDocument();
    });

    test('filter shows empty state when no comments match', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      await user.selectOptions(
        screen.getByRole('combobox', { name: /filter comments by status/i }),
        'acknowledged'
      );
      expect(screen.getByText(/No acknowledged comments/i)).toBeInTheDocument();
    });

    test('filter dropdown counts update correctly', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      const filter = screen.getByRole('combobox', { name: /filter comments by status/i });
      expect(filter).toHaveTextContent('All (3)');
      expect(filter).toHaveTextContent('Open (2)');
      expect(filter).toHaveTextContent('Resolved (1)');
    });
  });

  // ── Edit Comment (criteria 17, 18, 19) ───────────────────────────────────

  describe('Edit Comment', () => {
    test('edit button visible only to comment author (criterion 17)', () => {
      // PROF_USER (user-1) authored c1 and c3
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      const editButtons = screen.getAllByRole('button', { name: /Edit comment by/i });
      expect(editButtons).toHaveLength(2);
    });

    test('edit button NOT visible to non-author (criterion 18)', () => {
      useAuthStore.mockImplementation((selector) => selector({ user: OTHER_PROF }));
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      expect(
        screen.queryByRole('button', { name: /Edit comment by/i })
      ).not.toBeInTheDocument();
    });

    test('save calls editComment with updated content (criterion 19)', async () => {
      const user = userEvent.setup();
      const onCommentUpdated = jest.fn();
      render(<CommentThread comments={mockComments} onCommentUpdated={onCommentUpdated} />);

      // Edit c1 (first edit button — Prof. Smith authored c1 first in DOM)
      const editButtons = screen.getAllByRole('button', { name: /Edit comment by Prof. Smith/i });
      await user.click(editButtons[0]);

      const editTextarea = screen.getByRole('textbox', { name: /Edit comment:/i });
      await user.clear(editTextarea);
      await user.type(editTextarea, 'Updated content');

      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(editComment).toHaveBeenCalledWith('c1', 'Updated content');
        expect(onCommentUpdated).toHaveBeenCalled();
      });
    });

    test('cancel edit hides the edit textarea', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const editButtons = screen.getAllByRole('button', { name: /Edit comment by Prof. Smith/i });
      await user.click(editButtons[0]);
      expect(screen.getByRole('textbox', { name: /Edit comment:/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(
        screen.queryByRole('textbox', { name: /Edit comment:/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── Resolve Comment (criteria 20, 21) ────────────────────────────────────

  describe('Resolve Comment', () => {
    test('resolve button shown on unresolved comments for professor (criterion 20)', () => {
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);
      // c1 and c2 are open; c3 is resolved → 2 resolve buttons
      const resolveButtons = screen.getAllByRole('button', {
        name: /Mark comment as resolved/i,
      });
      expect(resolveButtons).toHaveLength(2);
    });

    test('resolve button NOT shown on already-resolved comment', () => {
      render(
        <CommentThread comments={[mockComments[2]]} onCommentUpdated={jest.fn()} />
      );
      expect(
        screen.queryByRole('button', { name: /Mark comment as resolved/i })
      ).not.toBeInTheDocument();
    });

    test('professor can resolve a comment they did not author', () => {
      // c2 is authored by user-2; PROF_USER is user-1 → professor can still resolve
      render(<CommentThread comments={[mockComments[1]]} onCommentUpdated={jest.fn()} />);
      expect(
        screen.getByRole('button', { name: /Mark comment as resolved/i })
      ).toBeInTheDocument();
    });

    test('clicking resolve calls resolveComment with commentId (criterion 21)', async () => {
      const user = userEvent.setup();
      const onCommentUpdated = jest.fn();
      render(<CommentThread comments={mockComments} onCommentUpdated={onCommentUpdated} />);

      const resolveButtons = screen.getAllByRole('button', {
        name: /Mark comment as resolved/i,
      });
      await user.click(resolveButtons[0]); // resolves c1

      await waitFor(() => {
        expect(resolveComment).toHaveBeenCalledWith('c1');
        expect(onCommentUpdated).toHaveBeenCalled();
      });
    });
  });

  // ── Reply Form (criteria 22, 23, 24, 25) ─────────────────────────────────

  describe('Reply Form', () => {
    test('reply button expands inline textarea (criterion 22)', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      expect(
        screen.queryByRole('textbox', { name: /Add reply to comment/i })
      ).not.toBeInTheDocument();

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]);

      expect(
        screen.getByRole('textbox', { name: /Add reply to comment/i })
      ).toBeInTheDocument();
    });

    test('only one reply form open at a time', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]); // open reply on c1
      // After opening reply on c1, c1's Reply button is replaced by the form
      // c2 and c3 still have Reply buttons; only 1 textarea open
      expect(
        screen.getAllByRole('textbox', { name: /Add reply to comment/i })
      ).toHaveLength(1);
    });

    test('submit calls addReply with commentId and content (criterion 23)', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]); // open c1 reply form

      await user.type(
        screen.getByRole('textbox', { name: /Add reply to comment/i }),
        'My reply text'
      );
      await user.click(screen.getByRole('button', { name: /Send Reply/i }));

      await waitFor(() => {
        expect(addReply).toHaveBeenCalledWith('c1', 'My reply text');
      });
    });

    test('onCommentUpdated called after reply submitted — triggers thread refresh (criterion 24)', async () => {
      const user = userEvent.setup();
      const onCommentUpdated = jest.fn();
      render(<CommentThread comments={mockComments} onCommentUpdated={onCommentUpdated} />);

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]);

      await user.type(
        screen.getByRole('textbox', { name: /Add reply to comment/i }),
        'My reply'
      );
      await user.click(screen.getByRole('button', { name: /Send Reply/i }));

      await waitFor(() => expect(onCommentUpdated).toHaveBeenCalled());
    });

    test('student can submit a reply via addReply (criterion 25)', async () => {
      const user = userEvent.setup();
      useAuthStore.mockImplementation((selector) => selector({ user: STUDENT_USER }));
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]);

      await user.type(
        screen.getByRole('textbox', { name: /Add reply to comment/i }),
        'Student reply'
      );
      await user.click(screen.getByRole('button', { name: /Send Reply/i }));

      await waitFor(() => {
        expect(addReply).toHaveBeenCalledWith('c1', 'Student reply');
      });
    });

    test('cancel reply closes the form', async () => {
      const user = userEvent.setup();
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]);
      expect(
        screen.getByRole('textbox', { name: /Add reply to comment/i })
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(
        screen.queryByRole('textbox', { name: /Add reply to comment/i })
      ).not.toBeInTheDocument();
    });

    test('Send Reply button shows Sending... during API call', async () => {
      const user = userEvent.setup();
      addReply.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ replyId: 'r-new' }), 100))
      );
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const replyButtons = screen.getAllByRole('button', { name: /Reply to comment by/i });
      await user.click(replyButtons[0]);

      await user.type(
        screen.getByRole('textbox', { name: /Add reply to comment/i }),
        'My reply'
      );
      await user.click(screen.getByRole('button', { name: /Send Reply/i }));

      expect(screen.getByText('Sending...')).toBeInTheDocument();
    });
  });

  // ── Loading and Error States (criteria 26, 27) ────────────────────────────

  describe('Loading and Error States', () => {
    test('shows loading indicator when loading prop is true (criterion 26)', () => {
      render(
        <CommentThread comments={[]} loading={true} onCommentUpdated={jest.fn()} />
      );
      expect(screen.getByText(/Loading comments/i)).toBeInTheDocument();
    });

    test('loading hides the comment list', () => {
      render(
        <CommentThread comments={mockComments} loading={true} onCommentUpdated={jest.fn()} />
      );
      expect(screen.queryByText('Great proposal!')).not.toBeInTheDocument();
    });

    test('shows error message when error prop is set (criterion 27)', () => {
      render(
        <CommentThread
          comments={[]}
          error="Failed to load comments — server returned 500"
          onCommentUpdated={jest.fn()}
        />
      );
      expect(
        screen.getByText('Failed to load comments — server returned 500')
      ).toBeInTheDocument();
    });

    test('error hides the comment list', () => {
      render(
        <CommentThread
          comments={mockComments}
          error="Something went wrong"
          onCommentUpdated={jest.fn()}
        />
      );
      expect(screen.queryByText('Great proposal!')).not.toBeInTheDocument();
    });

    test('Resolve button shows Resolving... during API call (criterion 26)', async () => {
      const user = userEvent.setup();
      resolveComment.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
      );
      render(<CommentThread comments={mockComments} onCommentUpdated={jest.fn()} />);

      const resolveButtons = screen.getAllByRole('button', {
        name: /Mark comment as resolved/i,
      });
      await user.click(resolveButtons[0]);

      expect(screen.getByText('Resolving...')).toBeInTheDocument();
    });
  });
});
