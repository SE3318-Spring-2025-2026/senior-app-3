import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReviewStatus, getReviews } from '../api/reviewAPI';
import ReviewAssignmentForm from '../components/reviews/ReviewAssignmentForm';
import useAuthStore from '../store/authStore';
import './ReviewManagement.css';

/**
 * ReviewManagement Page Component
 * Coordinator-only dashboard for managing review assignments and monitoring progress
 * URL: /dashboard/reviews
 */
const ReviewManagement = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // State management
  const [stats, setStats] = useState({
    pending: 0,
    in_progress: 0,
    needs_clarification: 0,
    completed: 0,
  });
  const [reviews, setReviews] = useState([]);
  // FIX: removed unused filteredReviews state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedDeliverable, setSelectedDeliverable] = useState(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);

  const PAGE_SIZE = 20;

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

  // Get status badge styling
  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-gray-100 text-gray-800',
      in_progress: 'bg-blue-100 text-blue-800',
      needs_clarification: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-green-100 text-green-800',
    };
    return styles[status] || 'bg-gray-100 text-gray-800';
  };

  // Format date helper
  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Fetch review status and stats
  const fetchReviewStatus = useCallback(async () => {
    try {
      const data = await getReviewStatus();
      setStats({
        pending: data.pending || 0,
        in_progress: data.in_progress || 0,
        needs_clarification: data.needs_clarification || 0,
        completed: data.completed || 0,
      });
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to load review statistics';
      if (err?.response?.status === 403) {
        setError('You do not have permission to view reviews');
        navigate('/dashboard');
      } else {
        setError(message);
      }
    }
  }, [navigate]);

  // Fetch reviews with optional filtering
  // FIX: added loading state management here so loading covers both calls
  const fetchReviews = useCallback(async (page = 1, status = 'all') => {
    try {
      const options = {
        page,
        limit: PAGE_SIZE,
        ...(status !== 'all' && { status }),
      };

      const data = await getReviews(options);
      setReviews(data.reviews || []);
      setCurrentPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to load reviews';
      setError(message);
    }
  }, []);

  // FIX: initial load runs both fetches in parallel under a single loading gate
  // statusFilter is NOT in the dependency array to avoid double-fetching on filter change
  useEffect(() => {
    if (!user || (user.role !== 'coordinator' && user.role !== 'admin')) {
      navigate('/dashboard');
      return;
    }

    const initialLoad = async () => {
      setLoading(true);
      setError('');
      try {
        await Promise.all([fetchReviewStatus(), fetchReviews(1, 'all')]);
      } finally {
        setLoading(false);
      }
    };

    initialLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate]);

  // Handle status filter change — manual fetch, no useEffect dependency on statusFilter
  const handleStatusFilterChange = async (status) => {
    setStatusFilter(status);
    setCurrentPage(1);
    setError('');
    setLoading(true);
    try {
      await fetchReviews(1, status);
    } finally {
      setLoading(false);
    }
  };

  // Handle pagination
  const handlePageChange = async (newPage) => {
    setError('');
    setLoading(true);
    try {
      await fetchReviews(newPage, statusFilter);
    } finally {
      setLoading(false);
    }
    document.querySelector('.reviews-table-container')?.scrollIntoView({ behavior: 'smooth' });
  };

  // Handle assignment form open
  const handleAssignClick = (review) => {
    setSelectedDeliverable(review);
    setShowAssignmentForm(true);
  };

  // Handle assignment form close
  const handleAssignmentClose = () => {
    setShowAssignmentForm(false);
    setSelectedDeliverable(null);
  };

  // Handle assignment success — refresh both stats and list
  const handleAssignmentSuccess = async () => {
    setShowAssignmentForm(false);
    setSelectedDeliverable(null);
    setLoading(true);
    setError('');
    try {
      await Promise.all([fetchReviewStatus(), fetchReviews(currentPage, statusFilter)]);
    } finally {
      setLoading(false);
    }
  };

  // Authorization check (before loading UI)
  if (!user || (user.role !== 'coordinator' && user.role !== 'admin')) {
    return (
      <div className="review-management-page">
        <div className="max-w-4xl mx-auto p-8">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-yellow-900 mb-2">Access Denied</h2>
            <p className="text-yellow-800 mb-4">
              You do not have permission to access the review management dashboard.
            </p>
            <a
              href="/dashboard"
              className="inline-block px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
            >
              ← Back to Dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="review-management-page">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600 font-medium">Loading reviews...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="review-management-page">
      {/* Header */}
      <div className="review-management-header">
        <div>
          <h1 className="page-title">Review Management</h1>
          <p className="page-subtitle">Monitor and assign deliverable reviews</p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="max-w-6xl mx-auto px-4 mb-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="review-stats-container">
        <div className="stat-card">
          <div className="stat-value text-gray-700">{stats.pending}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-blue-600">{stats.in_progress}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-yellow-600">{stats.needs_clarification}</div>
          <div className="stat-label">Clarification</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-green-600">{stats.completed}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      {/* Reviews Section */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Filter Controls */}
        <div className="review-controls">
          <div>
            <label htmlFor="statusFilter" className="filter-label">
              Filter by Status:
            </label>
            <select
              id="statusFilter"
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Reviews</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="needs_clarification">Needs Clarification</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {/* Reviews Table */}
        <div className="reviews-table-container">
          {reviews.length === 0 ? (
            <div className="empty-state">
              <p className="text-gray-600">No reviews found.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="reviews-table">
                <thead>
                  <tr>
                    <th scope="col">Deliverable ID</th>
                    <th scope="col">Type</th>
                    <th scope="col">Group ID</th>
                    <th scope="col">Sprint</th>
                    <th scope="col">Status</th>
                    <th scope="col">Comments</th>
                    <th scope="col">Clarifications</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => (
                    <tr key={review.deliverableId || review.id}>
                      <td>
                        <code className="text-sm">{review.deliverableId || review.id}</code>
                      </td>
                      <td>{getDeliverableTypeName(review.deliverableType || review.type)}</td>
                      <td>{review.groupId || review.group_id || 'N/A'}</td>
                      <td>{review.sprintId || review.sprint_id || 'N/A'}</td>
                      <td>
                        <span
                          className={`status-badge ${getStatusBadge(
                            review.reviewStatus || review.status
                          )}`}
                        >
                          {(review.reviewStatus || review.status || 'pending')
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </span>
                      </td>
                      <td className="text-center">{review.commentCount || 0}</td>
                      <td className="text-center">{review.clarificationsRemaining || 0}</td>
                      <td>{formatDate(review.deadline)}</td>
                      <td>
                        {review.deliverableStatus === 'accepted' && !review.reviewStatus ? (
                          <button
                            onClick={() => handleAssignClick(review)}
                            className="btn-sm btn-primary"
                            title="Assign reviewers to this deliverable"
                          >
                            Assign
                          </button>
                        ) : (
                          <a
                            href={`/dashboard/reviews/${review.deliverableId || review.id}`}
                            className="btn-sm btn-secondary"
                            title="View review details"
                          >
                            View
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="pagination-btn"
              aria-label="Previous page"
            >
              ← Previous
            </button>
            <span className="pagination-info" aria-live="polite">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="pagination-btn"
              aria-label="Next page"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Assignment Form Modal */}
      {showAssignmentForm && selectedDeliverable && (
        <ReviewAssignmentForm
          deliverable={selectedDeliverable}
          onSuccess={handleAssignmentSuccess}
          onCancel={handleAssignmentClose}
        />
      )}
    </div>
  );
};

export default ReviewManagement;