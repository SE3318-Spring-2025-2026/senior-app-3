import React, { useState } from 'react';
import { renderMarkdown } from '../../utils/markdownRenderer';
import useAuthStore from '../../store/authStore';
import { editComment, resolveComment, addReply } from '../../api/reviewAPI';
import './CommentThread.css';

/**
 * CommentThread Component
 * Displays a threaded comment structure with replies, filtering, and inline editing
 */
const CommentThread = ({
  comments = [],
  onCommentUpdated,
  loading = false,
  error = null,
}) => {
  const user = useAuthStore((state) => state.user);
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyContent, setReplyContent] = useState('');
  const [submittingState, setSubmittingState] = useState({});
  const [errorState, setErrorState] = useState({});

  // Filter comments by status
  const filteredComments = statusFilter === 'all'
    ? comments
    : comments.filter((c) => c.status === statusFilter);

  // Handle edit mode
  const handleEditClick = (comment) => {
    setEditingCommentId(comment.commentId);
    setEditingContent(comment.content);
  };

  // Save edited comment
  const handleSaveEdit = async (commentId) => {
    if (!editingContent.trim()) {
      setErrorState((prev) => ({
        ...prev,
        [commentId]: 'Content cannot be empty',
      }));
      return;
    }

    try {
      setSubmittingState((prev) => ({ ...prev, [commentId]: true }));
      setErrorState((prev) => ({ ...prev, [commentId]: null }));

      await editComment(commentId, editingContent);
      setEditingCommentId(null);
      setEditingContent('');

      if (onCommentUpdated) {
        onCommentUpdated();
      }
    } catch (err) {
      setErrorState((prev) => ({
        ...prev,
        [commentId]: err?.response?.data?.message || 'Failed to update comment',
      }));
    } finally {
      setSubmittingState((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  // Cancel edit mode
  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingContent('');
  };

  // Handle resolve comment
  // BUG FIX: Previously only the comment author could resolve. Now professors and
  // coordinators can also resolve any comment, matching backend permission model.
  const handleResolveComment = async (commentId) => {
    try {
      setSubmittingState((prev) => ({ ...prev, [commentId]: true }));
      setErrorState((prev) => ({ ...prev, [commentId]: null }));

      await resolveComment(commentId);

      if (onCommentUpdated) {
        onCommentUpdated();
      }
    } catch (err) {
      setErrorState((prev) => ({
        ...prev,
        [commentId]: err?.response?.data?.message || 'Failed to resolve comment',
      }));
    } finally {
      setSubmittingState((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  // Handle adding reply
  const handleAddReply = async (commentId) => {
    if (!replyContent.trim()) {
      setErrorState((prev) => ({
        ...prev,
        [commentId]: 'Reply cannot be empty',
      }));
      return;
    }

    try {
      setSubmittingState((prev) => ({ ...prev, [commentId]: true }));
      setErrorState((prev) => ({ ...prev, [commentId]: null }));

      await addReply(commentId, replyContent);
      setReplyingToId(null);
      setReplyContent('');

      if (onCommentUpdated) {
        onCommentUpdated();
      }
    } catch (err) {
      setErrorState((prev) => ({
        ...prev,
        [commentId]: err?.response?.data?.message || 'Failed to add reply',
      }));
    } finally {
      setSubmittingState((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  // BUG FIX: Professors and coordinators can resolve any comment; authors can
  // only resolve their own. Previously the resolve button was gated entirely on
  // authorship, so professors could never resolve comments they didn't write.
  const canResolve = (comment) => {
    if (!user) return false;
    if (user.role === 'professor' || user.role === 'coordinator') return true;
    return user.userId === comment.authorId;
  };

  const getCommentTypeBadgeColor = (type) => {
    const colors = {
      general: 'bg-gray-200 text-gray-800',
      question: 'bg-blue-200 text-blue-800',
      clarification_required: 'bg-orange-200 text-orange-800',
      suggestion: 'bg-green-200 text-green-800',
      praise: 'bg-purple-200 text-purple-800',
    };
    return colors[type] || colors.general;
  };

  const getStatusBadgeColor = (status) => {
    const colors = {
      open: 'bg-red-100 text-red-800 border border-red-300',
      resolved: 'bg-green-100 text-green-800 border border-green-300',
      acknowledged: 'bg-blue-100 text-blue-800 border border-blue-300',
    };
    return colors[status] || colors.open;
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="comment-thread-container">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-2 text-gray-600">Loading comments...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="comment-thread-container">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-semibold">Error loading comments</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="comment-thread-container">
      {/* Filter bar */}
      <div className="comment-thread-filters mb-6">
        <label htmlFor="status-filter" className="text-sm font-medium text-gray-700 mr-3">
          Filter by Status:
        </label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-transparent"
          aria-label="Filter comments by status"
        >
          <option value="all">All ({comments.length})</option>
          <option value="open">Open ({comments.filter((c) => c.status === 'open').length})</option>
          <option value="resolved">Resolved ({comments.filter((c) => c.status === 'resolved').length})</option>
          <option value="acknowledged">Acknowledged ({comments.filter((c) => c.status === 'acknowledged').length})</option>
        </select>
      </div>

      {/* Comments list */}
      <div className="comment-thread-list space-y-4">
        {filteredComments.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <p className="text-gray-600">
              {statusFilter === 'all'
                ? 'No comments yet. Be the first to comment!'
                : `No ${statusFilter} comments.`}
            </p>
          </div>
        ) : (
          filteredComments.map((comment) => (
            <div
              key={comment.commentId}
              className={`comment-item border rounded-lg p-4 ${
                comment.needsResponse && comment.status === 'open'
                  ? 'border-orange-400 bg-orange-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {/* Comment header */}
              <div className="comment-header flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">
                      {comment.authorName}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatDate(comment.createdAt)}
                    </p>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getCommentTypeBadgeColor(comment.commentType)}`}>
                    {comment.commentType.replace(/_/g, ' ')}
                  </span>
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusBadgeColor(comment.status)}`}>
                    {comment.status}
                  </span>
                  {comment.needsResponse && comment.status === 'open' && (
                    <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-red-200 text-red-800 font-semibold">
                      ⚠️ Needs Response
                    </span>
                  )}
                </div>
              </div>

              {/* Section number */}
              {comment.sectionNumber && (
                <div className="text-sm text-gray-600 mb-3 font-medium">
                  Section {comment.sectionNumber}
                </div>
              )}

              {/* Comment content - edit or display */}
              {editingCommentId === comment.commentId ? (
                <div className="mb-3">
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-transparent resize-none"
                    rows="4"
                    aria-label={`Edit comment: ${comment.content.substring(0, 50)}`}
                  />
                  {errorState[comment.commentId] && (
                    <p className="text-red-600 text-sm mt-2">{errorState[comment.commentId]}</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleSaveEdit(comment.commentId)}
                      disabled={submittingState[comment.commentId]}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {submittingState[comment.commentId] ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="comment-content text-gray-800 mb-3 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(comment.content),
                  }}
                />
              )}

              {/* Action buttons */}
              {editingCommentId !== comment.commentId && (
                <div className="flex gap-2 mb-3">
                  {/* Edit: only for comment author */}
                  {user?.userId === comment.authorId && (
                    <button
                      onClick={() => handleEditClick(comment)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      aria-label={`Edit comment by ${comment.authorName}`}
                    >
                      Edit
                    </button>
                  )}
                  {/* BUG FIX: Resolve is now available to professors/coordinators
                      AND the comment author, not just the author. */}
                  {comment.status !== 'resolved' && canResolve(comment) && (
                    <button
                      onClick={() => handleResolveComment(comment.commentId)}
                      disabled={submittingState[comment.commentId]}
                      className="text-green-600 hover:text-green-800 text-sm font-medium disabled:text-gray-400"
                      aria-label="Mark comment as resolved"
                    >
                      {submittingState[comment.commentId] ? 'Resolving...' : 'Resolve'}
                    </button>
                  )}
                </div>
              )}

              {/* Replies */}
              {comment.replies && comment.replies.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                  <h5 className="text-sm font-medium text-gray-700">Replies ({comment.replies.length})</h5>
                  {comment.replies.map((reply) => (
                    <div key={reply.replyId} className="ml-4 p-3 bg-gray-50 rounded">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          {/* BUG FIX: was showing reply.authorId (a UUID) instead of
                              reply.authorName (the display name). */}
                          <p className="text-sm font-semibold text-gray-900">
                            {reply.authorName ?? reply.authorId}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDate(reply.createdAt)}
                          </p>
                        </div>
                      </div>
                      <p
                        className="text-sm text-gray-800"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(reply.content),
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Reply form */}
              {replyingToId === comment.commentId ? (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write your reply..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-transparent resize-none"
                    rows="3"
                    aria-label="Add reply to comment"
                  />
                  {errorState[comment.commentId] && (
                    <p className="text-red-600 text-sm mt-2">{errorState[comment.commentId]}</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleAddReply(comment.commentId)}
                      disabled={submittingState[comment.commentId]}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {submittingState[comment.commentId] ? 'Sending...' : 'Send Reply'}
                    </button>
                    <button
                      onClick={() => {
                        setReplyingToId(null);
                        setReplyContent('');
                      }}
                      className="px-3 py-1 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setReplyingToId(comment.commentId)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium mt-2"
                  aria-label={`Reply to comment by ${comment.authorName}`}
                >
                  Reply
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CommentThread;