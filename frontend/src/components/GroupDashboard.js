import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useGroupStore from '../store/groupStore';
import useAuthStore from '../store/authStore';
import GitHubStatusCard from './GitHubStatusCard';
import GitHubSetupForm from './GitHubSetupForm';
import JiraStatusCard from './JiraStatusCard';
import JiraSetupForm from './JiraSetupForm';
import GroupMemberList from './GroupMemberList';
import AddMemberForm from './AddMemberForm';
import CommitteeStatusCard from './CommitteeStatusCard';
import DeliverableSubmissionForm from './DeliverableSubmissionForm';
import { submitMembershipDecision, getMyPendingInvitation } from '../api/groupService';
import { releaseAdvisor } from '../api/advisorService';
import { normalizeGroupId } from '../utils/groupId';
import './GroupDashboard.css';

/**
 * Group Dashboard Component
 * Senior Architecture: Handles polling, manual refresh, and integration states.
 */
const GroupDashboard = () => {
  const { group_id: groupIdParam } = useParams();
  const groupId = normalizeGroupId(groupIdParam);
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const pollingIntervalRef = useRef(null);
  
  const [manualRefresh, setManualRefresh] = useState(false);
  const [invitationInfo, setInvitationInfo] = useState(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionMsg, setDecisionMsg] = useState('');
  
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState('');

  const {
    groupData,
    committeeStatus,
    members,
    github,
    jira,
    pendingApprovalsCount,
    isLoading,
    lastUpdated,
    fetchGroupDashboard,
    startPolling,
    stopPolling,
  } = useGroupStore();

  useEffect(() => {
    if (!groupId) navigate('/dashboard');
  }, [groupId, navigate]);

  useEffect(() => {
    if (groupId) {
      pollingIntervalRef.current = startPolling(groupId, 30000);
    }
    return () => {
      if (pollingIntervalRef.current) stopPolling(pollingIntervalRef.current);
    };
  }, [groupId, startPolling, stopPolling]);

  useEffect(() => {
    if (!groupId || !user) return;
    const invitationRequest = typeof getMyPendingInvitation === 'function'
      ? getMyPendingInvitation()
      : Promise.resolve(null);

    Promise.resolve(invitationRequest).then((inv) => {
      if (inv && inv.group_id === groupId) {
        setInvitationInfo(inv);
      }
    }).catch(() => { });
  }, [groupId, user]);

  const handleDecision = async (decision) => {
    setDecisionLoading(true);
    setDecisionMsg('');
    try {
      await submitMembershipDecision(groupId, decision, user.userId);
      setInvitationInfo(null);
      setDecisionMsg(decision === 'accepted' ? 'You have joined the group!' : 'Invitation declined.');
      if (decision === 'accepted') fetchGroupDashboard(groupId);
    } catch (err) {
      setDecisionMsg(err.response?.data?.message || 'Could not process your decision.');
    } finally {
      setDecisionLoading(false);
    }
  };

  const handleReleaseAdvisor = async () => {
    if (!groupData?.advisorId) return;
    setReleaseLoading(true);
    setReleaseError('');
    try {
      await releaseAdvisor(groupId, releaseReason);
      setReleaseModalOpen(false);
      setReleaseReason('');
      await fetchGroupDashboard(groupId);
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) setReleaseError('You are not authorized to release this advisor.');
      else if (status === 409) setReleaseError('Group does not currently have an assigned advisor.');
      else if (status === 422) setReleaseError('The advisor association schedule is currently closed.');
      else setReleaseError(err.response?.data?.message || 'Failed to release advisor.');
    } finally {
      setReleaseLoading(false);
    }
  };

  const handleRefresh = async () => {
    setManualRefresh(true);
    try {
      await fetchGroupDashboard(groupId);
    } finally {
      setManualRefresh(false);
    }
  };

  const isCoordinator = user?.role === 'coordinator' || user?.role === 'admin';
  const isLeader = groupData?.leaderId === user?.userId;
  const studentSprintId =
    groupData?.currentSprintId ||
    groupData?.activeSprintId ||
    groupData?.latestSprintId ||
    groupData?.sprintId;

  if (!groupId) return <div className="page error">Invalid group ID</div>;

  return (
    <div className="group-dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">
            {groupData?.groupName || 'Group Dashboard'}
            {groupData?.status && (
              <span className={`group-status-badge ${groupData.status}`}>
                {groupData.status.replace('_', ' ')}
              </span>
            )}
          </h1>
          {lastUpdated && (
            <p className="last-updated">
              Last updated: {new Date(lastUpdated).toLocaleTimeString()}
            </p>
          )}
        </div>

        <div className="dashboard-actions">
          <button 
            className="refresh-button" 
            onClick={handleRefresh} 
            disabled={manualRefresh || isLoading}
            title="Refresh dashboard data"
          >
            {manualRefresh ? 'Refreshing...' : 'Refresh'}
          </button>
          
          <Link to={`/groups/${groupId}/advisor`}>
            <button className="coordinator-panel-btn">
              {isLeader ? "Advisor Panel" : "View Advisor"}
            </button>
          </Link>

          {isCoordinator && (
            <button className="coordinator-panel-btn" onClick={() => navigate(`/groups/${groupId}/coordinator`)}>
              Coordinator Panel
            </button>
          )}
        </div>
      </div>

      {invitationInfo && (
        <div className="invitation-banner">
          <p>You have been invited to join <strong>{groupData?.groupName || invitationInfo.group_name}</strong>.</p>
          <div className="invitation-actions">
            <button className="accept-btn" onClick={() => handleDecision('accepted')} disabled={decisionLoading}>
              {decisionLoading ? 'Processing…' : 'Accept'}
            </button>
            <button className="reject-btn" onClick={() => handleDecision('rejected')} disabled={decisionLoading}>
              Decline
            </button>
          </div>
          {decisionMsg && <p className="decision-msg">{decisionMsg}</p>}
        </div>
      )}

      {groupData && (
        <>
          <div className="dashboard-grid">
            <GitHubStatusCard data={github} isLoading={isLoading} />
            <JiraStatusCard data={jira} isLoading={isLoading} />

            <div className="status-card">
              <div className="card-header">
                <h3 className="card-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px'}}>
                    <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm2 1H6a4 4 0 00-4 4v1h12v-1a4 4 0 00-4-4z" />
                  </svg>
                  Advisor
                </h3>
                {groupData.advisorId ? (
                  <span className="status-badge active">Assigned</span>
                ) : groupData.advisorRequest?.status === 'pending' ? (
                  <span className="status-badge pending">Pending</span>
                ) : (
                  <span className="status-badge none">Not Assigned</span>
                )}
              </div>
              <div className="card-content">
                {groupData.advisorId ? (
                  <div className="info-row assigned-advisor-row">
                    <div className="advisor-info">
                      <span className="info-label">Assigned:</span>
                      <span className="info-value">Dr. {groupData.advisorName || 'Faculty Advisor'}</span>
                    </div>
                    {(isLeader || isCoordinator) && (
                      <button className="release-advisor-btn-outline" onClick={() => setReleaseModalOpen(true)} title="Release advisor from this group">
                        Release
                      </button>
                    )}
                  </div>
                ) : groupData.advisorRequest?.status === 'pending' ? (
                  <div className="advisor-empty-state">
                    <p className="card-hint">Request pending for <strong>{groupData.advisorRequest.professorName || 'Professor'}</strong></p>
                    {groupData.advisorRequest.notificationTriggered === false && (
                      <span className="small-text-warning"> (Delivery pending)</span>
                    )}
                  </div>
                ) : (
                  <div className="advisor-empty-state">
                    <p className="card-hint">No advisor assigned yet.</p>
                    {isLeader && groupData.status === 'active' && (
                      <button className="request-advisor-btn" onClick={() => navigate(`/groups/${groupId}/advisor-request`)}>
                        Request Advisor
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="status-card">
              <div className="card-header">
                <h3 className="card-title">Pending Approvals</h3>
                <span className={`approval-badge ${pendingApprovalsCount === 0 ? 'zero' : ''}`}>
                  {pendingApprovalsCount}
                </span>
              </div>
              <div className="card-content">
                <div className="info-row">
                  <span className="info-label">Awaiting Response:</span>
                  <span className="info-value">{pendingApprovalsCount} members</span>
                </div>
              </div>
            </div>
          </div>

          <CommitteeStatusCard committeeStatus={committeeStatus} user={user} />

          <GroupMemberList members={members} isLoading={isLoading} groupLeaderId={groupData?.leaderId} />

          {isLeader && (
            <div className="management-sections">
              <div className="integration-section">
                <h2 className="integration-title">GitHub Setup</h2>
                <GitHubSetupForm groupId={groupId} onSuccess={() => fetchGroupDashboard(groupId)} isLeader={isLeader} />
              </div>
              <div className="integration-section">
                <h2 className="integration-title">JIRA Setup</h2>
                <JiraSetupForm groupId={groupId} onSuccess={() => fetchGroupDashboard(groupId)} isLeader={isLeader} />
              </div>
              <AddMemberForm groupId={groupId} onMemberAdded={() => fetchGroupDashboard(groupId)} />
            </div>
          )}

          <DeliverableSubmissionForm
            groupId={groupId}
            sprintId={studentSprintId || undefined}
            isLeader={isLeader}
            userId={user?.userId}
            members={members}
            committeeStatus={committeeStatus?.committee?.status}
            onSuccess={() => fetchGroupDashboard(groupId)}
          />

          {user?.role === 'student' && studentSprintId && (
            <div className="student-progress-section">
              <div>
                <h2 className="student-progress-title">Sprint Progress</h2>
                <p className="student-progress-copy">
                  View your read-only sprint contribution metrics from the latest computed backend snapshot.
                </p>
              </div>
              <Link
                className="student-progress-link"
                to={`/groups/${groupId}/sprints/${studentSprintId}/progress`}
              >
                View Sprint Progress
              </Link>
            </div>
          )}

          <div className="group-info-footer">
            Group ID: {groupData.groupId} · Status: {groupData.status}
          </div>

          {releaseModalOpen && (
            <div className="modal-overlay">
              <div className="modal-content release-modal">
                <h2>Release Advisor</h2>
                <p>Are you sure you want to release <strong>Dr. {groupData.advisorName}</strong>?</p>
                <p className="modal-warning">This action will clear the current assignment and allow you to request a new advisor.</p>
                <div className="form-group">
                  <label htmlFor="releaseReason">Reason for Release (optional):</label>
                  <textarea
                    id="releaseReason"
                    value={releaseReason}
                    onChange={(e) => setReleaseReason(e.target.value)}
                    placeholder="Provide a reason for releasing the advisor..."
                    rows="3"
                  />
                </div>
                {releaseError && <div className="modal-error">{releaseError}</div>}
                <div className="modal-actions">
                  <button className="cancel-btn" onClick={() => { setReleaseModalOpen(false); setReleaseError(''); }} disabled={releaseLoading}>
                    Cancel
                  </button>
                  <button className="confirm-release-btn" onClick={handleReleaseAdvisor} disabled={releaseLoading}>
                    {releaseLoading ? 'Releasing...' : 'Confirm Release'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GroupDashboard;
