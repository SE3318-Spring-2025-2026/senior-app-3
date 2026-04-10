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
import { submitMembershipDecision, getMyPendingInvitation } from '../api/groupService';
import './GroupDashboard.css';

/**
 * Group Dashboard Component
 * Displays group information, members, integration status, and pending approvals
 */
const GroupDashboard = () => {
  const { group_id: groupId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const pollingIntervalRef = useRef(null);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [invitationInfo, setInvitationInfo] = useState(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionMsg, setDecisionMsg] = useState('');


  const {
    groupData,
    members,
    github,
    jira,
    pendingApprovalsCount,
    isLoading,
    error,
    lastUpdated,
    fetchGroupDashboard,
    startPolling,
    stopPolling,
  } = useGroupStore();

 
  useEffect(() => {
    if (!groupId) {
      navigate('/');
    }
  }, [groupId, navigate]);


  useEffect(() => {
    if (groupId) {
      pollingIntervalRef.current = startPolling(groupId, 30000);
    }

    return () => {
      if (pollingIntervalRef.current) {
        stopPolling(pollingIntervalRef.current);
      }
    };
  }, [groupId, startPolling, stopPolling]);

 
  useEffect(() => {
    if (!groupId || !user) return;

    getMyPendingInvitation()
      .then((inv) => {
        if (inv && inv.group_id === groupId) {
          setInvitationInfo(inv);
        }
      })
      .catch(() => {});
  }, [groupId, user]);

  const handleDecision = async (decision) => {
    setDecisionLoading(true);
    setDecisionMsg('');

    try {
      await submitMembershipDecision(groupId, decision, user.userId);
      setInvitationInfo(null);
      setDecisionMsg(
        decision === 'accepted'
          ? 'You have joined the group!'
          : 'Invitation declined.'
      );

      if (decision === 'accepted') {
        fetchGroupDashboard(groupId);
      }
    } catch (err) {
      setDecisionMsg(
        err.response?.data?.message || 'Could not process your decision.'
      );
    } finally {
      setDecisionLoading(false);
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

 
  const handleCoordinatorPanel = () => {
    navigate(`/groups/${groupId}/coordinator`);
  };

  if (!groupId) {
    return <div className="page error">Invalid group ID</div>;
  }

  return (
    <div className="group-dashboard">
      {/* Header Section */}
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
            <button
              type="button"
              className="coordinator-panel-btn"
              title={isLeader ? "Open advisor association panel (Edit mode)" : "View current group advisor information (Read-only)"}
            >
              {isLeader ? "Advisor Panel" : "View Advisor"}
            </button>
          </Link>

          {isCoordinator && (
            <button
              className="coordinator-panel-btn"
              onClick={handleCoordinatorPanel}
              title="Open coordinator panel"
            >
              Coordinator Panel
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-container">
          <div className="error-title">Error</div>
          <p className="error-message">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && !groupData && (
        <div className="loading">Loading group dashboard...</div>
      )}

      {/* Invitation Banner — visible to invited users who haven't responded yet */}
      {invitationInfo && (
        <div className="invitation-banner">
          <p>
            You have been invited to join{' '}
            <strong>{groupData?.groupName || invitationInfo.group_name}</strong>.
          </p>

          <div className="invitation-actions">
            <button
              className="accept-btn"
              onClick={() => handleDecision('accepted')}
              disabled={decisionLoading}
            >
              {decisionLoading ? 'Processing…' : 'Accept'}
            </button>

            <button
              className="reject-btn"
              onClick={() => handleDecision('rejected')}
              disabled={decisionLoading}
            >
              Decline
            </button>
          </div>

          {decisionMsg && <p className="decision-msg">{decisionMsg}</p>}
        </div>
      )}

      {!invitationInfo && decisionMsg && (
        <div className="invitation-banner resolved">
          <p>{decisionMsg}</p>
        </div>
      )}

      {/* Main Content */}
      {groupData && (
        <>
          {/* Status Cards Grid */}
          <div className="dashboard-grid">
            <div>
              <GitHubStatusCard data={github} isLoading={isLoading} />
            </div>

            <div>
              <JiraStatusCard data={jira} isLoading={isLoading} />
            </div>

            <div className="status-card">
              <div className="card-header">
                <h3 className="card-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3a1 1 0 11-2 0 1 1 0 012 0zM6.5 6h3v5.5h-1V7h-2V6z" />
                  </svg>
                  Pending Approvals
                </h3>

                <span
                  className={`approval-badge ${
                    pendingApprovalsCount === 0 ? 'zero' : ''
                  }`}
                >
                  {pendingApprovalsCount}
                </span>
              </div>

              <div className="card-content">
                <div className="info-row">
                  <span className="info-label">Members Awaiting Response:</span>
                  <span className="info-value">{pendingApprovalsCount}</span>
                </div>

                {pendingApprovalsCount > 0 && (
                  <p className="card-hint">
                    {pendingApprovalsCount} student
                    {pendingApprovalsCount !== 1 ? 's' : ''}{' '}
                    {pendingApprovalsCount !== 1 ? 'have' : 'has'} not yet responded.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Members Section */}
          <GroupMemberList
            members={members}
            isLoading={isLoading}
            groupLeaderId={groupData?.leaderId}
          />

          {/* GitHub Integration Setup — Team Leader only */}
          {isLeader && (
            <div className="integration-section">
              <h2 className="integration-title">GitHub Integration Setup</h2>
              <GitHubSetupForm
                groupId={groupId}
                onSuccess={() => {
                  fetchGroupDashboard(groupId);
                }}
                onError={(error) => {
                  console.error('GitHub setup error:', error);
                }}
                isLeader={isLeader}
              />
            </div>
          )}

          {/* JIRA Integration Setup — Team Leader only (Process 2.7) */}
          {isLeader && (
            <div className="integration-section">
              <h2 className="integration-title">JIRA Integration Setup</h2>
              <JiraSetupForm
                groupId={groupId}
                onSuccess={() => fetchGroupDashboard(groupId)}
                onError={(error) => console.error('JIRA setup error:', error)}
                isLeader={isLeader}
              />
            </div>
          )}

          {/* Add Member — Team Leader only */}
          {isLeader && (
            <AddMemberForm
              groupId={groupId}
              onMemberAdded={() => fetchGroupDashboard(groupId)}
            />
          )}

          {/* Group Information Footer */}
          <div className="group-info-footer">
            Group ID: {groupData?.groupId} &nbsp;·&nbsp; Created:{' '}
            {groupData?.createdAt
              ? new Date(groupData.createdAt).toLocaleDateString()
              : 'N/A'}
            &nbsp;·&nbsp; Status: {groupData?.status || 'Unknown'}
          </div>
        </>
      )}
    </div>
  );
};

export default GroupDashboard;