import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useGroupStore from '../store/groupStore';
import useAuthStore from '../store/authStore';
import GitHubStatusCard from './GitHubStatusCard';
import JiraStatusCard from './JiraStatusCard';
import GroupMemberList from './GroupMemberList';
import AddMemberForm from './AddMemberForm';
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

  // Group store state
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

  // Validate group ID
  useEffect(() => {
    if (!groupId) {
      navigate('/');
    }
  }, [groupId, navigate]);

  // Initial load and polling setup
  useEffect(() => {
    if (groupId) {
      // Start polling for real-time updates (refresh every 30 seconds)
      pollingIntervalRef.current = startPolling(groupId, 30000);
    }

    return () => {
      // Cleanup polling on unmount
      if (pollingIntervalRef.current) {
        stopPolling(pollingIntervalRef.current);
      }
    };
  }, [groupId, startPolling, stopPolling]);

  // Handle manual refresh
  const handleRefresh = async () => {
    setManualRefresh(true);
    try {
      await fetchGroupDashboard(groupId);
    } finally {
      setManualRefresh(false);
    }
  };

  // Check if user is coordinator (has coordinator role or is admin)
  const isCoordinator = user?.role === 'coordinator' || user?.role === 'admin';

  // Check if current user is the group leader
  const isLeader = groupData?.leaderId === user?.userId;

  // Handle coordinator panel navigation
  const handleCoordinatorPanel = () => {
    // Navigate to coordinator panel for this group
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

      {/* Main Content */}
      {groupData && (
        <>
          {/* Status Cards Grid */}
          <div className="dashboard-grid">
            {/* GitHub Status Card */}
            <div>
              <GitHubStatusCard data={github} isLoading={isLoading} />
            </div>

            {/* JIRA Status Card */}
            <div>
              <JiraStatusCard data={jira} isLoading={isLoading} />
            </div>

            {/* Pending Approvals Card */}
            <div className="status-card">
              <div className="card-header">
                <h3 className="card-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3a1 1 0 11-2 0 1 1 0 012 0zM6.5 6h3v5.5h-1V7h-2V6z" />
                  </svg>
                  Pending Approvals
                </h3>
                <span className={`approval-badge ${pendingApprovalsCount === 0 ? 'zero' : ''}`}>
                  {pendingApprovalsCount}
                </span>
              </div>
              <div className="card-content">
                <div className="info-row">
                  <span className="info-label">Members Awaiting Response:</span>
                  <span className="info-value">{pendingApprovalsCount}</span>
                </div>
                {pendingApprovalsCount > 0 && (
                  <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '12px' }}>
                    {pendingApprovalsCount} student{pendingApprovalsCount !== 1 ? 's' : ''} {pendingApprovalsCount !== 1 ? 'have' : 'has'} not yet responded to the membership request.
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

          {/* Add Member — Team Leader only (Process 2.3) */}
          {isLeader && (
            <AddMemberForm
              groupId={groupId}
              onMemberAdded={() => fetchGroupDashboard(groupId)}
            />
          )}

          {/* Group Information Footer */}
          <div style={{ marginTop: '24px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
            <p style={{ margin: 0 }}>
              Group ID: {groupData?.groupId} | Created: {
                groupData?.createdAt 
                  ? new Date(groupData.createdAt).toLocaleDateString()
                  : 'N/A'
              } | Status: {groupData?.status || 'Unknown'}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default GroupDashboard;
