import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import reviewService from '../api/reviewService';
import authStore from '../store/authStore';

/**
 * ReviewManagement Page
 * 
 * Coordinator dashboard for managing all review assignments
 * 
 * Features:
 * - Display list of all reviews with pagination
 * - Filter reviews by status (pending, in_progress, completed, needs_clarification)
 * - Stat cards showing review counts
 * - View detailed review information
 * - Assign new reviews
 */
const ReviewManagement = () => {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState([]);
  const [statCounts, setStatCounts] = useState({
    pending: 0,
    in_progress: 0,
    needs_clarification: 0,
    completed: 0
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;

  // Check authorization
  useEffect(() => {
    const user = authStore.getState().user;
    if (!user || user.role !== 'coordinator') {
      navigate('/dashboard');
      return;
    }
  }, [navigate]);

  // Fetch reviews
  useEffect(() => {
    const fetchReviews = async () => {
      setLoading(true);
      try {
        const status = filter === 'all' ? null : filter;
        const response = await reviewService.getReviewsForCoordinator({
          page: currentPage,
          limit: itemsPerPage,
          status
        });

        setReviews(response.data || []);
        setTotalPages(Math.ceil((response.total || 0) / itemsPerPage));

        // Fetch stats
        const statsResponse = await reviewService.getReviewStatus();
        setStatCounts({
          pending: statsResponse.data?.pending || 0,
          in_progress: statsResponse.data?.in_progress || 0,
          needs_clarification: statsResponse.data?.needs_clarification || 0,
          completed: statsResponse.data?.completed || 0
        });
      } catch (error) {
        console.error('Failed to fetch reviews:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, [filter, currentPage]);

  const handleStatusChange = async (reviewId, newStatus) => {
    try {
      await reviewService.updateReviewStatus(reviewId, { status: newStatus });
      // Refresh reviews
      window.location.reload();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  if (loading) {
    return (
      <div className="review-management-page">
        <div className="loading-indicator" role="status">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="review-management-page">
      <h1>Review Management</h1>

      {/* Stat Cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <h3>Pending</h3>
          <p className="stat-count" data-testid="stat-pending">{statCounts.pending}</p>
        </div>
        <div className="stat-card">
          <h3>In Progress</h3>
          <p className="stat-count" data-testid="stat-in-progress">{statCounts.in_progress}</p>
        </div>
        <div className="stat-card">
          <h3>Needs Clarification</h3>
          <p className="stat-count" data-testid="stat-clarification">{statCounts.needs_clarification}</p>
        </div>
        <div className="stat-card">
          <h3>Completed</h3>
          <p className="stat-count" data-testid="stat-completed">{statCounts.completed}</p>
        </div>
      </div>

      {/* Filter Dropdown */}
      <div className="filter-section">
        <label htmlFor="status-filter">Filter by Status:</label>
        <select
          id="status-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setCurrentPage(1);
          }}
          data-testid="filter-dropdown"
        >
          <option value="all">All Reviews</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="needs_clarification">Needs Clarification</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Review List Table */}
      <table className="review-list" data-testid="review-list">
        <thead>
          <tr>
            <th>Group Name</th>
            <th>Status</th>
            <th>Deadline</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map(review => (
            <tr key={review.reviewId} data-testid={`review-row-${review.reviewId}`}>
              <td>{review.groupName}</td>
              <td>{review.status}</td>
              <td>{review.deadline}</td>
              <td>{review.createdAt}</td>
              <td>
                <button
                  onClick={() => handleStatusChange(review.reviewId, 'completed')}
                  data-testid={`update-status-${review.reviewId}`}
                >
                  Update
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="pagination">
        <button
          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
          disabled={currentPage === 1}
          data-testid="prev-page"
        >
          Previous
        </button>
        <span data-testid="page-info">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
          disabled={currentPage === totalPages}
          data-testid="next-page"
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default ReviewManagement;
