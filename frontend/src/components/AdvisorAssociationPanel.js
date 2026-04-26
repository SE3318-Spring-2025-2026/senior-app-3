import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  submitAdvisorRequest,
  releaseAdvisor,
  getAdvisorAssociationWindow,
  searchProfessors,
  transferAdvisor, // Combined service
} from '../api/advisorService';
import { getGroup, getAllGroups, advisorSanitization } from '../api/groupService';
import useAuthStore from '../store/authStore';
import { normalizeGroupId } from '../utils/groupId';
import './AdvisorAssociationPanel.css';

/**
 * Advisor Association Panel (Process 3.0)
 * Dual-Mode Senior Architecture:
 * 1. Management Mode: For Coordinators to oversee all groups (3.6 & 3.7).
 * 2. Group Mode: For Students to manage their own advisor (3.1 & 3.5).
 */
const AdvisorAssociationPanel = () => {
  const { group_id: groupIdParam } = useParams();
  const groupId = normalizeGroupId(groupIdParam);
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // --- Shared State ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [professors, setProfessors] = useState([]);

  // --- Coordinator Mode State ---
  const [allGroups, setAllGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [transferFormOpen, setTransferFormOpen] = useState(false);
  const [transferReason, setTransferReason] = useState('');
  const [newProfessorId, setNewProfessorId] = useState('');
  const [sanitizationConfirm, setSanitizationConfirm] = useState(false);

  // --- Student Mode State ---
  const [group, setGroup] = useState(null);
  const [message, setMessage] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const bypassScheduleWindow =
    process.env.REACT_APP_ALLOW_CLOSED_SCHEDULE_BYPASS === 'true' ||
    localStorage.getItem('allowAdvisorWindowBypass') === 'true';

  const isCoordinator = user?.role === 'coordinator' || user?.role === 'admin';

  // ✅ Data Loader
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load professors for both modes
      const profsData = await searchProfessors();
      setProfessors(profsData?.professors || profsData || []);

      if (isCoordinator && !groupId) {
        // Management Mode: Fetch all groups
        const groupsData = await getAllGroups();
        setAllGroups(groupsData.groups || groupsData);
      } else if (groupId) {
        // Group Mode: Fetch specific group context
        const [groupData, windowData] = await Promise.all([
          getGroup(groupId),
          getAdvisorAssociationWindow()
        ]);
        setGroup(groupData);
        setScheduleOpen(Boolean(windowData?.open) || bypassScheduleWindow);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load panel data');
    } finally {
      setLoading(false);
    }
  }, [isCoordinator, groupId, bypassScheduleWindow]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ✅ COORDINATOR ACTIONS (Process 3.6 & 3.7)
  const handleTransfer = async (e) => {
    e.preventDefault();
    try {
      await transferAdvisor(selectedGroupId, { newProfessorId, reason: transferReason });
      setSuccess('Advisor transferred successfully');
      setTransferFormOpen(false);
      loadData(); // Refresh list
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    }
  };

  const handleSanitize = async () => {
    if (!sanitizationConfirm) {
      setSanitizationConfirm(true);
      return;
    }
    try {
      const result = await advisorSanitization();
      setSuccess(`Sanitization complete! ${result.disbandedGroups.length} groups disbanded.`);
      setSanitizationConfirm(false);
      loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Sanitization failed');
      setSanitizationConfirm(false);
    }
  };

  // ✅ STUDENT ACTIONS (Process 3.1 & 3.5)
  const handleRequestSubmit = async () => {
    try {
      await submitAdvisorRequest({ groupId, professorId: newProfessorId, message });
      setSuccess('Advisor request submitted successfully');
      loadData();
    } catch (err) {
      if (err.response?.status === 422 && bypassScheduleWindow) {
        setError('Server still blocks advisor association. Ask coordinator to open advisor_association window.');
      } else {
        setError(err.response?.status === 422 ? 'Schedule window is closed' : (err.response?.data?.message || 'Request failed'));
      }
    }
  };

  const handleRelease = async () => {
    if (!window.confirm('Are you sure you want to release the current advisor?')) return;
    try {
      await releaseAdvisor(groupId);
      setSuccess('Advisor released successfully');
      loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Release failed');
    }
  };

  // ✅ Helper: Badge Renderer
  const renderStatusBadge = (status) => {
    const statusMap = {
      assigned: { class: 'badge-success', label: 'Assigned' },
      pending: { class: 'badge-warning', label: 'Pending' },
      released: { class: 'badge-info', label: 'Released' },
      disbanded: { class: 'badge-danger', label: 'Disbanded' }
    };
    const config = statusMap[status?.toLowerCase()] || { class: 'badge-default', label: status || 'None' };
    return <span className={`badge ${config.class}`}>{config.label}</span>;
  };

  if (loading) return <div className="loading-state">Syncing with D2 database...</div>;

  // ═══════════════════════════════════════════
  // RENDER: COORDINATOR VIEW
  // ═══════════════════════════════════════════
  if (isCoordinator && !groupId) {
    return (
      <div className="advisor-association-container">
        <header className="panel-header">
          <h1>Coordinator Control: Advisor Association</h1>
          <p>Global management of advisory relationships (Process 3.6 & 3.7)</p>
        </header>

        {error && <div className="alert alert-error">✕ {error}</div>}
        {success && <div className="alert alert-success">✓ {success}</div>}

        <section className="section">
          <table className="groups-table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>Advisor</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allGroups.map((g) => (
                <tr key={g.groupId}>
                  <td><strong>{g.groupName}</strong></td>
                  <td>{g.advisorName || 'Unassigned'}</td>
                  <td>{renderStatusBadge(g.advisorStatus)}</td>
                  <td>
                    <button className="btn-transfer" onClick={() => { setSelectedGroupId(g.groupId); setTransferFormOpen(true); }}>
                      Transfer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sanitization-box">
          <h3>Post-Deadline Sanitization</h3>
          <p>Disband groups without advisors after the official deadline.</p>
          <button className={`btn ${sanitizationConfirm ? 'btn-danger' : 'btn-sanitize'}`} onClick={handleSanitize}>
            {sanitizationConfirm ? 'Confirm: DISBAND ALL UNASSIGNED' : 'Trigger Sanitization'}
          </button>
          {sanitizationConfirm && <button className="btn-link" onClick={() => setSanitizationConfirm(false)}>Cancel</button>}
        </section>

        {/* Transfer Modal can be added here using transferFormOpen state */}
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER: STUDENT / GROUP VIEW
  // ═══════════════════════════════════════════
  const isLeader = group?.leaderId === user?.userId;

  return (
    <div className="advisor-association-container">
      <header className="panel-header">
        <h1>{group?.groupName} - Advisor Panel</h1>
        {renderStatusBadge(group?.advisorStatus)}
      </header>

      {!scheduleOpen && isLeader && (
        <div className="alert alert-warning">⏰ Schedule window is currently closed.</div>
      )}
      {bypassScheduleWindow && isLeader && (
        <div className="alert alert-warning">Bypass mode is enabled for schedule checks (testing only).</div>
      )}
      {error && <div className="alert alert-error">❌ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="dashboard-grid">
        <div className="status-card">
          <h3>Current Assignment</h3>
          {group?.advisorId ? (
            <div className="assigned-info">
              <p>Dr. {group.advisorName || group.advisorId}</p>
              {isLeader && <button className="btn-release" onClick={handleRelease}>Release Advisor</button>}
            </div>
          ) : (
            <p className="card-hint">No advisor assigned yet.</p>
          )}
        </div>

        {isLeader && !group?.advisorId && (
          <div className="request-form">
            <h3>Submit Request</h3>
            <select className="form-control" value={newProfessorId} onChange={(e) => setNewProfessorId(e.target.value)} disabled={!scheduleOpen}>
              <option value="">Select a professor</option>
              {professors.map((p) => <option key={p.userId} value={p.userId}>{p.name || p.email}</option>)}
            </select>
            <textarea className="form-control" placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} disabled={!scheduleOpen} />
            <button className="btn btn-primary" onClick={handleRequestSubmit} disabled={!scheduleOpen || !newProfessorId}>
              Submit to Professor
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvisorAssociationPanel;