import React from 'react';

const PublishConfirmationDialog = ({ open, committeeName, onCancel, onConfirm, loading }) => {
  if (!open) return null;

  return (
    <div className="publish-confirmation-dialog" data-testid="publish-confirmation-dialog">
      <div className="dialog-backdrop" />
      <div className="dialog-content">
        <h3>Confirm Publish</h3>
        <p>Are you sure you want to publish the committee <strong>{committeeName}</strong>?</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} data-testid="publish-cancel-btn">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            data-testid="publish-confirm-btn"
          >
            {loading ? 'Publishing…' : 'Confirm Publish'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PublishConfirmationDialog;
