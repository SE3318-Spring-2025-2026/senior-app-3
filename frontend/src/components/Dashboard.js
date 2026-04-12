import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getMyPendingInvitation } from '../api/groupService';
import { getMyAdvisorRequests, decideOnAdvisorRequest } from '../api/advisorService';
import './Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invitationError, setInvitationError] = useState('');
  const [advisorRequests, setAdvisorRequests] = useState([]);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const [decisionState, setDecisionState] = useState({});

  useEffect(() => {
    const loadStudentData = async () => {
      if (user?.role !== 'student') {
        setLoading(false);
        return;
      }

      getMyPendingInvitation()
        .then((inv) => setInvitation(inv))
        .catch((err) => {
          if (err?.response?.status !== 404) {
            setInvitationError('Could not load invitation status. Please refresh.');
          }
        })
        .finally(() => setLoading(false));
    };

    loadStudentData();
  }, [user?.role]);

  useEffect(() => {
    const loadAdvisorRequests = async () => {
      if (user?.role !== 'professor') {
        return;
      }

      setAdvisorLoading(true);
      setAdvisorError('');
      try {
        const data = await getMyAdvisorRequests();
        setAdvisorRequests(Array.isArray(data) ? data : []);
      } catch (error) {
        setAdvisorError('Could not load advisor requests. Please refresh.');
      } finally {
        setAdvisorLoading(false);
      }
    };

    loadAdvisorRequests();
  }, [user?.role]);

  const isStudent = user?.role === 'student';
  const isProfessor = user?.role === 'professor';

  const updateDecisionDraft = (requestId, updates) => {
    setDecisionState((prev) => ({
      ...prev,
      [requestId]: {
        reason: '',
        submitting: false,
        ...prev[requestId],
        ...updates,
      },
    }));
  };

  const handleDecision = async (requestId, decision) => {
    updateDecisionDraft(requestId, { submitting: true, error: '', success: '' });
    const draft = decisionState[requestId] || {};

    try {
      const response = await decideOnAdvisorRequest(
        requestId,
        decision,
        draft.reason || ''
      );

      setAdvisorRequests((prev) => prev.filter((item) => item.requestId !== requestId));
      updateDecisionDraft(requestId, {
        submitting: false,
        success:
          decision === 'approve'
            ? `Approved successfully. Group assigned: ${response.assignedGroupId || 'n/a'}`
            : 'Request rejected successfully.',
      });
    } catch (error) {
      const status = error?.response?.status;
      let message = 'Decision could not be processed.';
      if (status === 422) message = 'Advisor association schedule is closed.';
      if (status === 409) message = 'This request has already been processed.';
      if (status === 403) message = 'You are not allowed to decide this request.';
      if (status === 404) message = 'Advisor request was not found.';
      updateDecisionDraft(requestId, { submitting: false, error: message });
    }
  };

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

        {isProfessor && (
          <div className="dashboard-card dashboard-card-spaced">
            <h2 className="dashboard-card-title">Advisor Requests</h2>

            {advisorLoading && <div className="dashboard-loading">Loading advisor requests</div>}
            {!advisorLoading && advisorError && <p className="dashboard-error">{advisorError}</p>}

            {!advisorLoading && !advisorError && advisorRequests.length === 0 && (
              <div className="dashboard-empty">
                <p>No pending advisor requests right now.</p>
              </div>
            )}

            {!advisorLoading &&
              advisorRequests.map((item) => {
                const draft = decisionState[item.requestId] || {};
                return (
                  <div key={item.requestId} className="advisor-request-item">
                    <p className="advisor-request-meta">
                      <strong>Group:</strong> {item.groupId} | <strong>Requester:</strong> {item.requesterId}
                    </p>
                    {item.message && <p className="advisor-request-message">{item.message}</p>}
                    <textarea
                      className="advisor-reason-input"
                      placeholder="Optional reason"
                      value={draft.reason || ''}
                      onChange={(e) => updateDecisionDraft(item.requestId, { reason: e.target.value })}
                    />
                    <div className="advisor-action-row">
                      <button
                        className="btn-primary"
                        disabled={!!draft.submitting}
                        onClick={() => handleDecision(item.requestId, 'approve')}
                      >
                        Approve
                      </button>
                      <button
                        className="link-btn"
                        disabled={!!draft.submitting}
                        onClick={() => handleDecision(item.requestId, 'reject')}
                      >
                        Reject
                      </button>
                    </div>
                    {draft.error && <p className="dashboard-error">{draft.error}</p>}
                    {draft.success && <p className="dashboard-success">{draft.success}</p>}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
