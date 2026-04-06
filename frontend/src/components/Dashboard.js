import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getMyPendingInvitation } from '../api/groupService';

const Dashboard = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyPendingInvitation()
      .then((inv) => setInvitation(inv))
      .catch(() => {})
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

          {!loading && !invitation && (
            <p style={{ color: '#666' }}>
              No pending group invitations.{' '}
              <span
                style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate('/groups/new')}
              >
                Create a group
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
