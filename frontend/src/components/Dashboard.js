import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getMyPendingInvitation } from '../api/groupService';

const Dashboard = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invitationError, setInvitationError] = useState('');

  useEffect(() => {
    getMyPendingInvitation()
      .then((inv) => setInvitation(inv))
      .catch((err) => {
        if (err?.response?.status !== 404) {
          setInvitationError('Could not load invitation status. Please refresh.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const isStudent = user?.role === 'student';

  return (
    <div className="page" style={{ maxWidth: 600, margin: '40px auto', padding: '0 24px' }}>
      <h2>Dashboard</h2>

      {isStudent && (
        <div style={{ marginTop: 24 }}>
          {loading && <p style={{ color: '#666' }}>Checking for pending invitations…</p>}

          {!loading && invitation && (
            <div style={{
              background: '#fff8e1',
              border: '1px solid #f9a825',
              borderRadius: 8,
              padding: '16px 20px',
            }}>
              <p style={{ margin: '0 0 12px', color: '#5d4037' }}>
                You have a pending invitation to join <strong>{invitation.group_name}</strong>.
              </p>
              <button
                onClick={() => navigate(`/groups/${invitation.group_id}`)}
                style={{
                  padding: '8px 20px',
                  background: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                View Group &amp; Respond
              </button>
            </div>
          )}

            {!loading && invitationError && (
              <p className="dashboard-error">{invitationError}</p>
            )}

            {!loading && !invitation && !invitationError && (
              <div className="dashboard-empty">
                <p>You have no pending group invitations.</p>
                <button className="link-btn" onClick={() => navigate('/groups/new')}>
                  Create a group
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
