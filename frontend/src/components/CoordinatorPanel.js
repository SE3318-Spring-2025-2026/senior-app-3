import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * Coordinator Panel Component (Placeholder)
 * This component will be expanded with coordinator-specific functionality
 * such as approving/rejecting members, managing integrations, etc.
 */
const CoordinatorPanel = () => {
  const { group_id: groupId } = useParams();
  const navigate = useNavigate();

  const handleGoBack = () => {
    navigate(`/groups/${groupId}`);
  };

  return (
    <div className="page" style={{ padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <button 
            onClick={handleGoBack}
            style={{
              padding: '8px 16px',
              backgroundColor: '#e1e4e8',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              marginBottom: '16px'
            }}
          >
            ← Back to Group Dashboard
          </button>
        </div>

        <div style={{ 
          background: 'white', 
          padding: '24px', 
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
        }}>
          <h1 style={{ marginTop: 0 }}>Coordinator Panel - Group {groupId}</h1>
          <p style={{ color: '#666' }}>
            Coordinator panel functionality coming soon. This panel will allow coordinators to:
          </p>
          <ul style={{ color: '#666' }}>
            <li>Approve/reject pending member requests</li>
            <li>Manage group integrations</li>
            <li>View audit logs</li>
            <li>Configure group settings</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default CoordinatorPanel;
