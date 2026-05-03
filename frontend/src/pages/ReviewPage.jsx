import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDeliverableDetails, getComments, downloadDeliverable } from '../api/reviewAPI';
import CommentThread from '../components/reviews/CommentThread';
import AddCommentForm from '../components/reviews/AddCommentForm';
import useAuthStore from '../store/authStore';
import './ReviewPage.css';

/**
 * ReviewPage Component
 * Displays deliverable details and comment thread for committee member review
 * URL: /dashboard/reviews/:deliverableId
 */
const ReviewPage = () => {
  const { deliverableId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // State management
  const [deliverable, setDeliverable] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [error, setError] = useState('');
  const [commentsError, setCommentsError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Format date helper
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get deliverable type display name
  const getDeliverableTypeName = (type) => {
    const names = {
      proposal: 'Proposal',
      statement_of_work: 'Statement of Work',
      demo: 'Demo',
      interim_report: 'Interim Report',
      final_report: 'Final Report',
    };
    return names[type] || type;
  };

  // Fetch deliverable details
  const fetchDeliverable = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const data = await getDeliverableDetails(deliverableId);
      setDeliverable(data);
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to load deliverable details';
      if (err?.response?.status === 404) {
        setError('Deliverable not found');
      } else if (err?.response?.status === 403) {
        setError('You do not have permission to view this deliverable');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [deliverableId]);

  // Fetch comments
  const fetchComments = useCallback(async (page = 1) => {
    try {
      setCommentsLoading(true);
      setCommentsError('');

      const data = await getComments(deliverableId, { page, limit: 10 });
      setComments(data.comments || []);
      setCurrentPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to load comments';
      if (err?.response?.status === 404) {
        setCommentsError('Deliverable not found');
      } else if (err?.response?.status === 403) {
        setCommentsError('You do not have permission to view comments for this deliverable');
      } else {
        setCommentsError(message);
      }
    } finally {
      setCommentsLoading(false);
    }
  }, [deliverableId]);

  // Initial load
  useEffect(() => {
    if (deliverableId) {
      fetchDeliverable();
      fetchComments();
    }
  }, [deliverableId, fetchDeliverable, fetchComments]);

  // Handle file download
  const handleDownload = async () => {
    try {
      const response = await downloadDeliverable(deliverableId);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deliverable.deliverableType}_v${deliverable.version}.${deliverable.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  // Handle comment added or updated
  const handleCommentUpdated = () => {
    fetchComments(1);
  };

  // Handle pagination
  const handlePageChange = (newPage) => {
    fetchComments(newPage);
    // Scroll to comments section
    document.querySelector('.review-page-right')?.scrollIntoView({ behavior: 'smooth' });
  };

  // Loading state
  if (loading && !deliverable) {
    return (
      <div className="review-page">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-gray-600 font-medium">Loading deliverable...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !deliverable) {
    return (
      <div className="review-page">
        <div className="max-w-4xl mx-auto p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Deliverable</h2>
            <p className="text-red-800 mb-4">{error}</p>
            <button
              onClick={() => navigate(-1)}
              className="inline-block px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 cursor-pointer"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No deliverable
  if (!deliverable) {
    return (
      <div className="review-page">
        <div className="max-w-4xl mx-auto p-8">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-gray-600">Deliverable not found</p>
            <button
              onClick={() => navigate(-1)}
              className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="review-page page p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)} className="text-blue-600 hover:text-blue-800 text-sm font-medium mb-4 inline-block cursor-pointer bg-transparent border-none p-0">
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            Deliverable Review
          </h1>
          <p className="text-gray-600 mt-2">
            Review and provide feedback on this deliverable submission
          </p>
        </div>

        {/* Two-column layout */}
        <div className="review-page-grid gap-8">
          {/* Left panel - Deliverable metadata */}
          <div className="review-page-left">
            <div className="bg-white rounded-lg border border-gray-200 p-6 sticky top-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Deliverable Details</h2>

              {/* Deliverable info */}
              <div className="space-y-4">
                {/* Type */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700">Type</h3>
                  <p className="text-gray-900 mt-1">
                    {getDeliverableTypeName(deliverable.deliverableType)}
                  </p>
                </div>

                {/* Group */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700">Group</h3>
                  <p className="text-gray-900 mt-1">{deliverable.groupId}</p>
                </div>

                {/* Sprint */}
                {deliverable.sprintId && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700">Sprint</h3>
                    <p className="text-gray-900 mt-1">{deliverable.sprintId}</p>
                  </div>
                )}

                {/* Submitted at */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700">Submitted At</h3>
                  <p className="text-gray-900 mt-1">
                    {formatDate(deliverable.submittedAt)}
                  </p>
                </div>

                {/* Status */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700">Status</h3>
                  <p className="mt-1">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      deliverable.status === 'accepted'
                        ? 'bg-green-100 text-green-800'
                        : deliverable.status === 'under_review'
                          ? 'bg-blue-100 text-blue-800'
                          : deliverable.status === 'awaiting_resubmission'
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-gray-100 text-gray-800'
                    }`}>
                      {deliverable.status.replace(/_/g, ' ')}
                    </span>
                  </p>
                </div>

                {/* Version */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700">Version</h3>
                  <p className="text-gray-900 mt-1">v{deliverable.version || 1}</p>
                </div>

                {/* Description */}
                {deliverable.description && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700">Description</h3>
                    <p className="text-gray-900 mt-1 text-sm">{deliverable.description}</p>
                  </div>
                )}

                {/* File info */}
                <div className="pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700">File Information</h3>
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="text-gray-600">
                      <strong>Format:</strong> {deliverable.format}
                    </p>
                    <p className="text-gray-600">
                      <strong>Size:</strong> {(deliverable.fileSize / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={handleDownload}
                    className="mt-3 w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download File
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right panel - Comments and form */}
          <div className="review-page-right">
            {/* Add comment form */}
            {(user?.role === 'professor' || user?.role === 'coordinator') && (
              <AddCommentForm
                deliverableId={deliverableId}
                onCommentAdded={handleCommentUpdated}
                disabled={false}
              />
            )}

            {/* Comments section */}
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Comment Thread</h2>

              {/*
                BUG FIX: Previously commentsError was rendered here as a standalone
                banner AND also passed into <CommentThread error={commentsError}>,
                which rendered it a second time inside the component. Now we only
                pass the error to CommentThread and let it handle display, removing
                the duplicate inline banner.
              */}
              <CommentThread
                comments={comments}
                onCommentUpdated={handleCommentUpdated}
                loading={commentsLoading}
                error={commentsError}
              />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || commentsLoading}
                    className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    ← Previous
                  </button>

                  <div className="text-sm text-gray-600">
                    Page <span className="font-semibold">{currentPage}</span> of{' '}
                    <span className="font-semibold">{totalPages}</span>
                  </div>

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || commentsLoading}
                    className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewPage;