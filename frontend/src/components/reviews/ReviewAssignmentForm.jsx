import React, { useEffect, useState } from 'react';
import { assignReview, getCommitteeCandidates } from '../../api/reviewAPI';
import './ReviewAssignmentForm.css';

/**
 * ReviewAssignmentForm Component
 * Allows coordinators to assign reviewers to a deliverable
 * Triggered by clicking on a deliverable with status 'accepted'
 * Note: authorization is enforced at the route level (ReviewManagement page)
 */
const ReviewAssignmentForm = ({ deliverable, onSuccess, onCancel }) => {
  // Form state
  const [reviewDeadlineDays, setReviewDeadlineDays] = useState(7);
  const [selectedCommitteeMembers, setSelectedCommitteeMembers] = useState([]);
  const [instructions, setInstructions] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  // Format date
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Fetch committee candidates on mount
  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        setCandidatesLoading(true);
        const data = await getCommitteeCandidates();
        setCandidates(data.candidates || []);
      } catch (err) {
        const message = err?.response?.data?.message || 'Failed to load committee members';
        setError(message);
      } finally {
        setCandidatesLoading(false);
      }
    };

    fetchCandidates();
  }, []);

  // Handle committee member multi-select
  const handleMemberChange = (e) => {
    const options = e.target.options;
    const selected = [];
    for (let i = 0; i < options.length; i++) {
      if (options[i].selected) {
        selected.push(options[i].value);
      }
    }
    setSelectedCommitteeMembers(selected);
  };

  // Validate form fields
  const validateForm = () => {
    if (!reviewDeadlineDays || reviewDeadlineDays < 1 || reviewDeadlineDays > 30) {
      setError('Review deadline must be between 1 and 30 days');
      return false;
    }

    if (instructions.length > 2000) {
      setError('Instructions cannot exceed 2000 characters');
      return false;
    }

    return true;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validateForm()) return;

    try {
      setLoading(true);

      const assignmentData = {
        deliverableId: deliverable.id || deliverable.deliverableId,
        reviewDeadlineDays: parseInt(reviewDeadlineDays, 10),
        ...(selectedCommitteeMembers.length > 0 && { selectedCommitteeMembers }),
        ...(instructions.trim() && { instructions: instructions.trim() }),
      };

      const result = await assignReview(assignmentData);

      const deadlineDate = new Date();
      deadlineDate.setDate(deadlineDate.getDate() + parseInt(reviewDeadlineDays, 10));

      setSuccess(
        `Review assignment successful! ${
          result.assignedCount || selectedCommitteeMembers.length || 'Reviewers'
        } assigned. Deadline: ${formatDate(deadlineDate)}`
      );

      // Call onSuccess after showing confirmation briefly
      setTimeout(() => {
        if (onSuccess) onSuccess(result);
      }, 2000);
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to assign review';
      const code = err?.response?.data?.code;

      if (err?.response?.status === 403) {
        setError('You do not have permission to assign reviews');
      } else if (code) {
        setError(`${message} (${code})`);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!deliverable) {
    return (
      <div className="assignment-form bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">No deliverable selected.</p>
      </div>
    );
  }

  return (
    <div className="assignment-form-overlay" role="dialog" aria-modal="true" aria-labelledby="assign-form-title">
      <div className="assignment-form-modal">
        {/* Header */}
        <div className="assignment-form-header">
          <div>
            <h2 id="assign-form-title" className="text-xl font-bold text-gray-900">
              Assign Reviewers
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {getDeliverableTypeName(deliverable.deliverableType || deliverable.type)} •{' '}
              {deliverable.groupId || deliverable.group_id}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="assignment-form-body">
          {/* Error Alert */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Success Alert */}
          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg" role="status">
              <p className="text-green-800 text-sm">{success}</p>
            </div>
          )}

          {/* Deliverable ID (Read-only) */}
          <div className="form-group">
            <label htmlFor="deliverableId" className="form-label">
              Deliverable ID
            </label>
            <input
              type="text"
              id="deliverableId"
              value={deliverable.id || deliverable.deliverableId || ''}
              disabled
              className="form-input"
            />
          </div>

          {/* Review Deadline Days */}
          <div className="form-group">
            <label htmlFor="reviewDeadlineDays" className="form-label">
              Review Deadline (Days) <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <input
              type="number"
              id="reviewDeadlineDays"
              min="1"
              max="30"
              value={reviewDeadlineDays}
              onChange={(e) => setReviewDeadlineDays(e.target.value)}
              required
              disabled={loading}
              className="form-input"
              placeholder="e.g., 7"
            />
            <p className="text-xs text-gray-600 mt-1">Between 1 and 30 days</p>
          </div>

          {/* Committee Members Multi-Select */}
          <div className="form-group">
            <label htmlFor="committees" className="form-label">
              Assign Committee Members (Optional)
            </label>
            {candidatesLoading ? (
              <div className="text-sm text-gray-600">Loading committee members...</div>
            ) : candidates.length === 0 ? (
              <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded p-2">
                No committee members available for assignment
              </div>
            ) : (
              <select
                id="committees"
                multiple
                value={selectedCommitteeMembers}
                onChange={handleMemberChange}
                disabled={loading || candidatesLoading}
                className="form-input"
                size="5"
                aria-describedby="committees-hint"
              >
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.email})
                  </option>
                ))}
              </select>
            )}
            <p id="committees-hint" className="text-xs text-gray-600 mt-1">
              Hold Ctrl/Cmd to select multiple members
            </p>

            {/* Selected member tags */}
            {selectedCommitteeMembers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected members">
                {selectedCommitteeMembers.map((memberId) => {
                  const member = candidates.find((c) => c.id === memberId);
                  return (
                    <span
                      key={memberId}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                    >
                      {member?.name || memberId}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedCommitteeMembers(
                            selectedCommitteeMembers.filter((m) => m !== memberId)
                          )
                        }
                        className="text-blue-600 hover:text-blue-900 font-bold"
                        aria-label={`Remove ${member?.name || memberId}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="form-group">
            <label htmlFor="instructions" className="form-label">
              Review Instructions (Optional)
            </label>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength="2000"
              rows="4"
              disabled={loading}
              className="form-input"
              placeholder="Enter specific review instructions or criteria..."
            />
            <p className="text-xs text-gray-600 mt-1" aria-live="polite">
              {instructions.length}/2000 characters
            </p>
          </div>

          {/* Form Actions */}
          <div className="assignment-form-footer">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || candidatesLoading}
              className="btn btn-primary"
            >
              {loading ? 'Assigning...' : 'Assign Reviewers'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReviewAssignmentForm;