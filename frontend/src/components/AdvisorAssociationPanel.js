/**
 * Advisor Association Panel (Issue #66)
 * 
 * Coordinator panel for managing advisor associations across all groups.
 * Displays:
 * - Advisor Association Overview Table (all groups with status)
 * - Transfer Form per group (reassign advisor)
 * - Sanitization Trigger (disband unassigned groups)
 * 
 * Level 2.3 — Process 3.6 & 3.7 Implementation
 */

import React, { useState, useEffect, useCallback } from 'react';
import './AdvisorAssociationPanel.css';
import advisorAssociationService from '../api/advisorAssociationService';

const AdvisorAssociationPanel = ({ user }) => {
  // State management
  const [groups, setGroups] = useState([]);
  const [professors, setProfessors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [transferFormOpen, setTransferFormOpen] = useState(false);
  const [transferFormData, setTransferFormData] = useState({
    newProfessorId: '',
    reason: '',
  });
  const [sanitizationConfirm, setSanitizationConfirm] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);

  // ✅ Role guard: Only coordinators can access this panel
  if (user?.role !== 'coordinator') {
    return (
      <div className="advisor-association-error">
        <p>Access Denied: Only coordinators can access the Advisor Association panel.</p>
      </div>
    );
  }

  // ✅ Load groups and professors on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch groups
        const groupsData = await advisorAssociationService.getGroups();
        setGroups(groupsData);

        // Calculate unassigned count
        const unassigned = groupsData.filter(
          (g) => g.advisorStatus !== 'assigned'
        ).length;
        setUnassignedCount(unassigned);

        // Fetch available professors
        const professorsData = await advisorAssociationService.getAvailableProfessors();
        setProfessors(professorsData);
      } catch (err) {
        setError(err.message || 'Failed to load advisor association data');
        console.error('Load data error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // ✅ Clear messages after timeout
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // ✅ Handle transfer form submission
  const handleTransferSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!selectedGroupId || !transferFormData.newProfessorId) {
      setError('Please select a group and professor');
      return;
    }

    try {
      setError(null);
      const result = await advisorAssociationService.transferAdvisor(
        selectedGroupId,
        transferFormData.newProfessorId,
        transferFormData.reason
      );

      // Update local group state
      setGroups((prevGroups) =>
        prevGroups.map((g) =>
          g.groupId === selectedGroupId
            ? {
                ...g,
                professorId: result.group.professorId,
                advisorStatus: result.group.advisorStatus,
              }
            : g
        )
      );

      setSuccess(`Group transferred to new advisor successfully`);
      setTransferFormOpen(false);
      setTransferFormData({ newProfessorId: '', reason: '' });
      setSelectedGroupId(null);
    } catch (err) {
      setError(err.message || 'Transfer failed');
      console.error('Transfer error:', err);
    }
  }, [selectedGroupId, transferFormData]);

  // ✅ Handle group selection for transfer
  const handleSelectGroup = (groupId) => {
    setSelectedGroupId(groupId);
    setTransferFormOpen(true);
  };

  // ✅ Handle sanitization trigger
  const handleSanitize = useCallback(async () => {
    if (!sanitizationConfirm) {
      setSanitizationConfirm(true);
      return; // First click just shows confirmation
    }

    try {
      setError(null);
      const result = await advisorAssociationService.disbandUnassignedGroups();

      setSuccess(
        `Sanitization complete! ${result.count} unassigned group(s) disbanded.`
      );

      // Refresh groups
      const updatedGroups = await advisorAssociationService.getGroups();
      setGroups(updatedGroups);
      const newUnassignedCount = updatedGroups.filter(
        (g) => g.advisorStatus !== 'assigned'
      ).length;
      setUnassignedCount(newUnassignedCount);

      setSanitizationConfirm(false);
    } catch (err) {
      setError(err.message || 'Sanitization failed');
      setSanitizationConfirm(false);
      console.error('Sanitization error:', err);
    }
  }, [sanitizationConfirm]);

  // ✅ Get professor name by ID
  const getProfessorName = (professorId) => {
    const prof = professors.find((p) => p.userId === professorId);
    return prof?.email || professorId || 'Unassigned';
  };

  // ✅ Get status badge class
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'assigned':
        return 'badge-success';
      case 'transferred':
        return 'badge-info';
      case 'released':
        return 'badge-warning';
      case 'disbanded':
        return 'badge-danger';
      case 'pending':
        return 'badge-default';
      default:
        return 'badge-default';
    }
  };

  // ✅ Render loading state
  if (loading) {
    return (
      <div className="advisor-association-container">
        <div className="loading-spinner">
          <p>Loading advisor associations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="advisor-association-container">
      <div className="panel-header">
        <h1>Advisor Association Management</h1>
        <p className="subtitle">
          Manage advisor assignments across all groups (Process 3.6 & 3.7)
        </p>
      </div>

      {/* ═══════════════════════════════════════════ Messages ═══════════════════════════════════════════ */}
      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">✕</span>
          {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <span className="alert-icon">✓</span>
          {success}
        </div>
      )}

      {/* ═══════════════════════════════════════════ Overview Table ═══════════════════════════════════════════ */}
      <div className="section">
        <h2 className="section-title">Advisor Assignment Status</h2>
        <p className="section-description">
          View advisor assignment status and transfer advisors to different groups.
        </p>

        {groups.length === 0 ? (
          <div className="empty-state">
            <p>No groups found</p>
          </div>
        ) : (
          <div className="groups-table-wrapper">
            <table className="groups-table">
              <thead>
                <tr>
                  <th>Group Name</th>
                  <th>Leader</th>
                  <th>Current Advisor</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.groupId} className="group-row">
                    <td className="group-name-cell">
                      <strong>{group.groupName}</strong>
                      <span className="group-id">{group.groupId}</span>
                    </td>
                    <td>{group.leaderId}</td>
                    <td className="advisor-cell">
                      <span>
                        {getProfessorName(group.professorId)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${getStatusBadgeClass(group.advisorStatus)}`}>
                        {group.advisorStatus}
                      </span>
                    </td>
                    <td className="actions-cell">
                      <button
                        className="btn-transfer"
                        onClick={() => handleSelectGroup(group.groupId)}
                        disabled={group.advisorStatus === 'disbanded'}
                        title={
                          group.advisorStatus === 'disbanded'
                            ? 'Cannot transfer disbanded group'
                            : 'Transfer advisor'
                        }
                      >
                        Transfer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════ Transfer Form ═══════════════════════════════════════════ */}
      {transferFormOpen && selectedGroupId && (
        <div className="section transfer-section">
          <h2 className="section-title">Transfer Advisor</h2>
          <div className="transfer-form">
            <div className="form-group">
              <label htmlFor="selected-group">Group</label>
              <input
                id="selected-group"
                type="text"
                value={
                  groups.find((g) => g.groupId === selectedGroupId)?.groupName ||
                  ''
                }
                readOnly
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label htmlFor="professor-select">New Advisor *</label>
              <select
                id="professor-select"
                value={transferFormData.newProfessorId}
                onChange={(e) =>
                  setTransferFormData({
                    ...transferFormData,
                    newProfessorId: e.target.value,
                  })
                }
                className="form-control"
              >
                <option value="">-- Select a professor --</option>
                {professors.map((prof) => (
                  <option key={prof.userId} value={prof.userId}>
                    {prof.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="transfer-reason">Reason (optional)</label>
              <textarea
                id="transfer-reason"
                value={transferFormData.reason}
                onChange={(e) =>
                  setTransferFormData({
                    ...transferFormData,
                    reason: e.target.value,
                  })
                }
                placeholder="Why is this transfer needed?"
                className="form-control"
                rows={3}
              />
            </div>

            <div className="form-actions">
              <button
                className="btn btn-primary"
                onClick={handleTransferSubmit}
              >
                Confirm Transfer
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setTransferFormOpen(false);
                  setSelectedGroupId(null);
                  setTransferFormData({ newProfessorId: '', reason: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════ Sanitization Trigger ═══════════════════════════════════════════ */}
      <div className="section sanitization-section">
        <h2 className="section-title">Post-Deadline Sanitization</h2>
        <p className="section-description">
          Disband groups that remain unassigned after the advisor assignment deadline.
          Currently <strong>{unassignedCount} group(s)</strong> are unassigned.
        </p>

        <div className="sanitization-box">
          <p className="warning-text">
            ⚠️ This action will disband all unassigned groups and cannot be undone.
          </p>

          {sanitizationConfirm ? (
            <div className="confirm-box">
              <p>
                <strong>Are you sure?</strong> This will disband{' '}
                <strong>{unassignedCount}</strong> unassigned group(s).
              </p>
              <div className="confirm-actions">
                <button
                  className="btn btn-danger"
                  onClick={handleSanitize}
                >
                  Yes, Disband Groups
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setSanitizationConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-sanitize"
              onClick={handleSanitize}
              disabled={unassignedCount === 0}
              title={
                unassignedCount === 0
                  ? 'No unassigned groups to disband'
                  : `Disband ${unassignedCount} unassigned group(s)`
              }
            >
              Trigger Sanitization
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvisorAssociationPanel;
