import React, { useState } from 'react';
import { addComment } from '../../api/reviewAPI';
import useAuthStore from '../../store/authStore';
import './AddCommentForm.css';

/**
 * AddCommentForm Component
 * Form for committee members to add comments to deliverables
 * Only accessible to committee members and coordinators
 */
const AddCommentForm = ({
  deliverableId,
  onCommentAdded,
  disabled = false,
}) => {
  const user = useAuthStore((state) => state.user);
  const [content, setContent] = useState('');
  const [commentType, setCommentType] = useState('general');
  const [sectionNumber, setSectionNumber] = useState('');
  const [needsResponse, setNeedsResponse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Character count
  const contentLength = content.length;
  const maxLength = 5000;

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!content.trim()) {
      setError('Comment content is required');
      return;
    }

    if (content.length > maxLength) {
      setError(`Comment cannot exceed ${maxLength} characters`);
      return;
    }

    if (content.length < 1) {
      setError('Comment must be at least 1 character');
      return;
    }

    const section = sectionNumber ? parseInt(sectionNumber, 10) : null;
    if (sectionNumber && (isNaN(section) || section < 1)) {
      setError('Section number must be a positive integer');
      return;
    }

    try {
      setLoading(true);

      const commentData = {
        deliverableId,
        content: content.trim(),
        commentType,
        sectionNumber: section,
        needsResponse: commentType === 'clarification_required' ? needsResponse : false,
      };

      await addComment(commentData);

      // Reset form
      setContent('');
      setCommentType('general');
      setSectionNumber('');
      setNeedsResponse(false);
      setSuccess('Comment added successfully!');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);

      if (onCommentAdded) {
        onCommentAdded();
      }
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to add comment';
      if (err?.response?.status === 403) {
        setError('You do not have permission to add comments to this deliverable');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Check if user can comment
  const canComment = user?.role === 'professor' || user?.role === 'coordinator';

  if (!canComment) {
    return (
      <div className="add-comment-form bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-blue-800 text-sm">
          Only committee members and coordinators can add comments to deliverables.
        </p>
      </div>
    );
  }

  return (
    <div className="add-comment-form">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Comment</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Content textarea */}
        <div>
          <label htmlFor="comment-content" className="block text-sm font-medium text-gray-700 mb-2">
            Comment <span className="text-red-600">*</span>
          </label>
          <textarea
            id="comment-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={disabled || loading}
            placeholder="Enter your comment (supports markdown: **bold**, *italic*, `code`, [links](url))"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-transparent resize-vertical"
            rows="6"
            maxLength={maxLength}
            aria-label="Comment content"
            aria-describedby="comment-char-count"
          />
          <div className="flex justify-between items-center mt-2">
            <p id="comment-char-count" className="text-xs text-gray-500">
              {contentLength} / {maxLength} characters
            </p>
            {contentLength > maxLength * 0.9 && (
              <p className="text-xs text-orange-600">
                {maxLength - contentLength} characters remaining
              </p>
            )}
          </div>
        </div>

        {/* Comment type dropdown */}
        <div>
          <label htmlFor="comment-type" className="block text-sm font-medium text-gray-700 mb-2">
            Comment Type <span className="text-red-600">*</span>
          </label>
          <select
            id="comment-type"
            value={commentType}
            onChange={(e) => {
              setCommentType(e.target.value);
              if (e.target.value !== 'clarification_required') {
                setNeedsResponse(false);
              }
            }}
            disabled={disabled || loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-transparent"
            aria-label="Comment type"
          >
            <option value="general">General</option>
            <option value="question">Question</option>
            <option value="clarification_required">Clarification Required</option>
            <option value="suggestion">Suggestion</option>
            <option value="praise">Praise</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Choose the type of feedback you're providing
          </p>
        </div>

        {/* Section number input */}
        <div>
          <label htmlFor="section-number" className="block text-sm font-medium text-gray-700 mb-2">
            Section Number <span className="text-gray-400 font-normal">(Optional)</span>
          </label>
          <input
            id="section-number"
            type="number"
            value={sectionNumber}
            onChange={(e) => setSectionNumber(e.target.value)}
            disabled={disabled || loading}
            placeholder="e.g., 1, 2, 3..."
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-transparent"
            aria-label="Section number"
          />
          <p className="text-xs text-gray-500 mt-1">
            Specify which section this comment refers to
          </p>
        </div>

        {/* Needs response checkbox - only for clarification_required */}
        {commentType === 'clarification_required' && (
          <div className="bg-orange-50 border border-orange-200 rounded-md p-3">
            {/*
              BUG FIX: The CSS rule `.add-comment-form label` set `display: flex`
              on ALL labels inside the form, which broke the `block` layout of the
              field labels above (comment, type, section number). The checkbox row
              now uses a wrapper <div> with explicit inline-flex styling instead of
              relying on a <label> element, so the CSS rule no longer interferes
              with the field labels. The <label> here is scoped only to the checkbox
              via htmlFor, keeping accessibility intact.
            */}
            <div className="checkbox-row">
              <input
                id="needs-response-checkbox"
                type="checkbox"
                checked={needsResponse}
                onChange={(e) => setNeedsResponse(e.target.checked)}
                disabled={disabled || loading}
                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                aria-label="Mark as needing response"
              />
              <label
                htmlFor="needs-response-checkbox"
                className="text-sm font-medium text-gray-700"
              >
                Mark as requiring response from group
              </label>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              When checked, this comment will be highlighted for the group and they must provide a response.
            </p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Success message */}
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3">
            <p className="text-green-800 text-sm">{success}</p>
          </div>
        )}

        {/* Submit button */}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={disabled || loading || !content.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
            aria-label="Submit comment"
          >
            {loading ? 'Submitting...' : 'Post Comment'}
          </button>
          <button
            type="button"
            onClick={() => {
              setContent('');
              setCommentType('general');
              setSectionNumber('');
              setNeedsResponse(false);
              setError('');
            }}
            disabled={disabled || loading}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:cursor-not-allowed font-medium"
            aria-label="Clear form"
          >
            Clear
          </button>
        </div>

        {/* Helper text */}
        <div className="text-xs text-gray-500 space-y-1 pt-2">
          <p>📝 <strong>Markdown supported:</strong> **bold**, *italic*, `code`, [link](url)</p>
          <p>⚠️ <strong>Clarifications:</strong> Mark responses as needed to track group feedback</p>
        </div>
      </form>
    </div>
  );
};

export default AddCommentForm;