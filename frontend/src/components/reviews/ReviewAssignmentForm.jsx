import React, { useState } from 'react';
import reviewService from '../../api/reviewService';

/**
 * ReviewAssignmentForm Component
 * 
 * Allows coordinators to assign reviewers to deliverables
 * and set review deadlines with instructions.
 */
const ReviewAssignmentForm = ({ deliverableId, onSuccess }) => {
  const [selectedCommitteeMembers, setSelectedCommitteeMembers] = useState([]);
  const [reviewDeadlineDays, setReviewDeadlineDays] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleCommitteeChange = (memberId) => {
    setSelectedCommitteeMembers(prev => 
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Validation
    if (!reviewDeadlineDays || parseInt(reviewDeadlineDays) <= 0) {
      setError('Review deadline is required');
      return;
    }

    if (selectedCommitteeMembers.length === 0) {
      setError('At least one committee member must be selected');
      return;
    }

    setLoading(true);
    try {
      const requestBody = {
        deliverableId,
        reviewDeadlineDays: parseInt(reviewDeadlineDays),
        selectedCommitteeMembers,
        instructions: instructions || ''
      };

      await reviewService.assignReview(requestBody);
      setSuccess(true);
      setReviewDeadlineDays('');
      setSelectedCommitteeMembers([]);
      setInstructions('');
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.code || err.message || 'Failed to assign review');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="review-assignment-form">
      <h2>Assign Review</h2>
      
      {success && (
        <div className="success-message" role="alert">
          Review assignment created successfully!
        </div>
      )}

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {loading && (
        <div className="loading-indicator" role="status">
          Loading...
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="review-deadline">
            Review Deadline (Days)
          </label>
          <input
            id="review-deadline"
            type="number"
            value={reviewDeadlineDays}
            onChange={(e) => setReviewDeadlineDays(e.target.value)}
            required
            min="1"
            data-testid="deadline-input"
          />
        </div>

        <div className="form-group">
          <label>Select Committee Members</label>
          <div className="checkbox-group">
            {['member-1', 'member-2', 'member-3'].map(memberId => (
              <label key={memberId}>
                <input
                  type="checkbox"
                  value={memberId}
                  checked={selectedCommitteeMembers.includes(memberId)}
                  onChange={() => handleCommitteeChange(memberId)}
                  data-testid={`committee-member-${memberId}`}
                />
                Committee Member {memberId}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="instructions">Instructions</label>
          <textarea
            id="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Optional instructions for reviewers"
            data-testid="instructions-input"
          />
        </div>

        <button 
          type="submit" 
          disabled={loading}
          data-testid="submit-button"
        >
          {loading ? 'Assigning...' : 'Assign Review'}
        </button>
      </form>
    </div>
  );
};

export default ReviewAssignmentForm;
