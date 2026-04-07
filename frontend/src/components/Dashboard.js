import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getMyPendingInvitation } from '../api/groupService';
import './Dashboard.css';

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
    <div className="dashboard-page">
      <div className="dashboard-inner">
        <div className="dashboard-welcome">
          <h1>Welcome{user?.name ? `, ${user.name}` : ''}!</h1>
          <p>Manage your group, track invitations, and monitor integrations.</p>
        </div>

        {isStudent && (
          <div className="dashboard-card">
            <h2 className="dashboard-card-title">Group Invitation</h2>

            {loading && (
              <div className="dashboard-loading">Checking for invitations</div>
            )}

            {!loading && invitation && (
              <div className="invitation-notice">
                <p>
                  You have a pending invitation to join{' '}
                  <strong>{invitation.group_name}</strong>.
                </p>
                <button
                  className="btn-primary"
                  onClick={() => navigate(`/groups/${invitation.group_id}`)}
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
