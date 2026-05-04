import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listScheduleWindows,
  createScheduleWindow,
  deactivateScheduleWindow,
  getAllGroups,
  coordinatorOverride,
  transferAdvisor,
  getGroupStatus,
  transitionGroupStatus,
  getGroupMembers,
} from '../api/groupService';
import { listProfessors } from '../api/authService';
import useAuthStore from '../store/authStore';
import { listCommittees } from '../api/committeeService';

const OPERATION_TYPES = [
  { value: 'group_creation', label: 'Group Creation' },
  { value: 'member_addition', label: 'Member Addition' },
];

const GROUP_STATUSES = [
  { value: 'pending_validation', label: 'Pending Validation' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/**
 * Coordinator Panel
 * Manages all coordinator functions:
 * - View all groups with status and integration health
 * - Perform overrides (add members, remove members, update group fields)
 * - Configure schedule windows
 * - Monitor integration health
 */
const CoordinatorPanel = () => {
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);

  // Tab management
  const [activeTab, setActiveTab] = useState('groups');

  // Groups data
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState(null);

  // Committees data
  const [committees, setCommittees] = useState([]);
  const [committeesLoading, setCommitteesLoading] = useState(false);
  const [committeesError, setCommitteesError] = useState(null);

  // Professors data
  const [professors, setProfessors] = useState([]);
  const [professorsLoading, setProfessorsLoading] = useState(false);

  // Schedule windows data
  const [windows, setWindows] = useState([]);
  const [windowsLoading, setWindowsLoading] = useState(true);
  const [windowsError, setWindowsError] = useState(null);

  // Selected group for override actions
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);

  // Override form state
  const [overrideForm, setOverrideForm] = useState({
    action: 'add_member',
    targetStudentId: '',
    updates: {},
    reason: '',
  });
  const [overrideError, setOverrideError] = useState(null);
  const [overrideSuccess, setOverrideSuccess] = useState(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmDialogMessage, setConfirmDialogMessage] = useState('');

  // Advisor transfer form state
  const [transferForm, setTransferForm] = useState({
    groupId: '',
    newProfessorId: '',
    reason: '',
  });
  const [transferError, setTransferError] = useState(null);
  const [transferSuccess, setTransferSuccess] = useState(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  // Schedule window form state
  const [scheduleForm, setScheduleForm] = useState({
    operationType: 'group_creation',
    startsAt: '',
    endsAt: '',
    label: '',
  });
  const [scheduleError, setScheduleError] = useState(null);
  const [scheduleSuccess, setScheduleSuccess] = useState(null);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  // Load groups
  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const data = await getAllGroups();
      setGroups(data.groups || []);
    } catch (err) {
      setGroupsError('Failed to load groups.');
      console.error('Error loading groups:', err);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  // Load schedule windows
  const loadWindows = useCallback(async () => {
    setWindowsLoading(true);
    setWindowsError(null);
    try {
      const data = await listScheduleWindows();
      setWindows(data.windows || []);
    } catch (err) {
      setWindowsError('Failed to load schedule windows.');
    } finally {
      setWindowsLoading(false);
    }
  }, []);

  // Load committees
  const loadCommittees = useCallback(async () => {
    setCommitteesLoading(true);
    setCommitteesError(null);
    try {
      const data = await listCommittees();
      setCommittees(data.committees || []);
    } catch (err) {
      setCommitteesError('Failed to load committees.');
    } finally {
      setCommitteesLoading(false);
    }
  }, []);

  // Load professors
  const loadProfessors = useCallback(async () => {
    setProfessorsLoading(true);
    try {
      const data = await listProfessors();
      setProfessors(data.professors || []);
    } catch (err) {
      console.error('Failed to load professors:', err);
      setProfessors([]);
    } finally {
      setProfessorsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadGroups();
    loadWindows();
    loadCommittees();
    loadProfessors();
  }, [loadGroups, loadWindows, loadCommittees, loadProfessors]);

  // Load members for selected group (used by Remove Member dropdown)
  useEffect(() => {
    if (!selectedGroupId) {
      setGroupMembers([]);
      return;
    }
    setGroupMembersLoading(true);
    getGroupMembers(selectedGroupId)
      .then((data) => setGroupMembers(data.members || []))
      .catch(() => setGroupMembers([]))
      .finally(() => setGroupMembersLoading(false));
  }, [selectedGroupId]);

  // Handle override form change
  const handleOverrideFormChange = (e) => {
    const { name, value } = e.target;
    setOverrideForm((prev) => ({ ...prev, [name]: value }));
    setOverrideError(null);
  };

  // Handle override submission
  const handleOverrideSubmit = async (e) => {
    e.preventDefault();
    setOverrideError(null);
    setOverrideSuccess(null);

    if (!selectedGroupId) {
      setOverrideError('Please select a group.');
      return;
    }

    if (!overrideForm.reason.trim()) {
      setOverrideError('Reason is required.');
      return;
    }

    if (
      (overrideForm.action === 'add_member' || overrideForm.action === 'remove_member') &&
      !overrideForm.targetStudentId.trim()
    ) {
      setOverrideError('Student ID is required.');
      return;
    }

    if (overrideForm.action === 'update_group' && Object.keys(overrideForm.updates).length === 0) {
      setOverrideError('Please specify at least one field to update.');
      return;
    }

    // Show confirmation dialog for remove_member action
    if (overrideForm.action === 'remove_member') {
      setConfirmDialogMessage(
        `Are you sure you want to remove this student from the group? This action cannot be undone.`
      );
      setConfirmDialogOpen(true);
      return;
    }

    // For other actions, proceed directly
    await executeOverride();
  };

  // Execute the override action
  const executeOverride = async () => {
    setConfirmDialogOpen(false);
    setOverrideSubmitting(true);
    try {
      const payload = {
        action: overrideForm.action,
        reason: overrideForm.reason.trim(),
      };

      if (overrideForm.action === 'add_member' || overrideForm.action === 'remove_member') {
        payload.target_student_id = overrideForm.targetStudentId.trim();
      } else if (overrideForm.action === 'update_group') {
        payload.updates = overrideForm.updates;
      }

      const result = await coordinatorOverride(selectedGroupId, payload);
      setOverrideSuccess(`✓ ${result.confirmation}`);
      setOverrideForm({ action: 'add_member', targetStudentId: '', updates: {}, reason: '' });
      await loadGroups();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to perform override.';
      setOverrideError(msg);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  // Handle schedule form change
  const handleScheduleFormChange = (e) => {
    const { name, value } = e.target;
    setScheduleForm((prev) => ({ ...prev, [name]: value }));
    setScheduleError(null);
  };

  // Handle schedule submission
  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    setScheduleError(null);
    setScheduleSuccess(null);

    if (!scheduleForm.startsAt || !scheduleForm.endsAt) {
      setScheduleError('Both open and close times are required.');
      return;
    }

    if (new Date(scheduleForm.endsAt) <= new Date(scheduleForm.startsAt)) {
      setScheduleError('Close time must be after open time.');
      return;
    }

    setScheduleSubmitting(true);
    try {
      const startLocal = new Date(scheduleForm.startsAt);
      const endLocal = new Date(scheduleForm.endsAt);
      const timezoneOffsetMs = startLocal.getTimezoneOffset() * 60 * 1000;
      const startUTC = new Date(startLocal.getTime() - timezoneOffsetMs).toISOString();
      const endUTC = new Date(endLocal.getTime() - timezoneOffsetMs).toISOString();

      await createScheduleWindow(
        scheduleForm.operationType,
        startUTC,
        endUTC,
        scheduleForm.label
      );
      setScheduleSuccess(`✓ Schedule window created.`);
      setScheduleForm((prev) => ({ ...prev, startsAt: '', endsAt: '', label: '' }));
      await loadWindows();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to create schedule window.';
      setScheduleError(msg);
    } finally {
      setScheduleSubmitting(false);
    }
  };

  const handleDeactivateWindow = async (windowId) => {
    try {
      await deactivateScheduleWindow(windowId);
      setScheduleSuccess('✓ Schedule window deactivated.');
      await loadWindows();
    } catch (err) {
      setScheduleError('Failed to deactivate window.');
    }
  };

  const handleTransferFormChange = (e) => {
    const { name, value } = e.target;
    setTransferForm((prev) => ({ ...prev, [name]: value }));
    setTransferError(null);
  };

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    setTransferError(null);
    setTransferSuccess(null);

    if (!transferForm.groupId) {
      setTransferError('Please select a group.');
      return;
    }

    if (!transferForm.newProfessorId.trim()) {
      setTransferError('New professor ID is required.');
      return;
    }

    if (!user?.userId) {
      setTransferError('Coordinator session is missing.');
      return;
    }

    setTransferSubmitting(true);
    try {
      const result = await transferAdvisor(transferForm.groupId, {
        newProfessorId: transferForm.newProfessorId.trim(),
        reason: transferForm.reason.trim() || undefined,
      });
      setTransferSuccess(
        `✓ Group ${result.groupId} transferred to ${result.professorId} (${result.status}).`
      );
      setTransferForm({ groupId: '', newProfessorId: '', reason: '' });
      await loadGroups();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 422) {
        setTransferError('Advisor association schedule is closed.');
      } else if (status === 409) {
        setTransferError(err.response?.data?.message || 'Target professor has a conflicting assignment.');
      } else if (status === 403) {
        setTransferError('Only coordinators can perform advisor transfer.');
      } else if (status === 404) {
        setTransferError(err.response?.data?.message || 'Group or professor not found.');
      } else {
        setTransferError(err.response?.data?.message || 'Failed to transfer advisor.');
      }
    } finally {
      setTransferSubmitting(false);
    }
  };

  const activeWindows = windows.filter((w) => w.isActive);
  const inactiveWindows = windows.filter((w) => !w.isActive);
  const validGroups = groups.filter((group) => typeof group.groupId === 'string' && group.groupId.trim() !== '');

  // Integration health helper
  const getIntegrationHealthClass = (group) => {
    const hasErrors = group.integrationErrors && group.integrationErrors.length > 0;
    if (hasErrors) return 'error';
    if (group.githubConnected && group.jiraConnected) return 'healthy';
    if (group.githubConnected || group.jiraConnected) return 'partial';
    return 'none';
  };

  const labelStyle = { display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#24292e' };
  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5da', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' };
  const tabButtonStyle = (isActive) => ({
    padding: '10px 16px',
    background: isActive ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#fafbfc',
    color: isActive ? 'white' : '#24292e',
    border: isActive ? 'none' : '1px solid #d1d5da',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    flex: 1,
    textAlign: 'center',
  });

  return (
    <div style={{ padding: '24px', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(102, 126, 234, 0.08)',
          marginBottom: '22px',
          padding: '24px 28px',
          textAlign: 'center',
        }}>
          <h1 style={{ color: '#111827', fontSize: '28px', fontWeight: '700', lineHeight: '1.2', margin: 0 }}>
            Coordinator Panel
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: '8px 0 0' }}>
            Manage groups, overrides, schedule windows and committees
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{ background: '#ffffff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(102, 126, 234, 0.07)', marginBottom: '16px', padding: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button style={tabButtonStyle(activeTab === 'groups')} onClick={() => setActiveTab('groups')}>
            Groups ({groups.length})
          </button>
          <button style={tabButtonStyle(activeTab === 'overrides')} onClick={() => setActiveTab('overrides')}>
            Overrides
          </button>
          <button style={tabButtonStyle(activeTab === 'transfer')} onClick={() => setActiveTab('transfer')}>
            Advisor Transfer
          </button>
          <button style={tabButtonStyle(activeTab === 'schedule')} onClick={() => setActiveTab('schedule')}>
            Schedule Windows
          </button>
          <button style={tabButtonStyle(activeTab === 'health')} onClick={() => setActiveTab('health')}>
            Integration Health
          </button>
          <button style={tabButtonStyle(activeTab === 'committees')} onClick={() => setActiveTab('committees')}>
            Committees ({committees.length})
          </button>
        </div>

        {/* ──── GROUPS TAB ──── */}
        {activeTab === 'groups' && (
          <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', color: '#24292e' }}>All Groups</h2>
            {groupsLoading && <p style={{ color: '#666' }}>Loading groups…</p>}
            {groupsError && <p style={{ color: '#d73a49' }}>{groupsError}</p>}

            {!groupsLoading && validGroups.length === 0 && (
              <p style={{ color: '#666', fontSize: '14px' }}>No groups found.</p>
            )}

            {!groupsLoading && validGroups.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e4e8', backgroundColor: '#f6f8fa' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Group ID</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Group Name</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Leader</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Members</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>GitHub</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>JIRA</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Grades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validGroups.map((group, idx) => (
                      <tr key={`group-row-${idx}-${group.groupId || group._id || 'unknown'}`} style={{ borderBottom: '1px solid #e1e4e8' }}>
                        <td style={{ padding: '12px', fontFamily: '\"SF Mono\", Monaco, monospace', fontSize: '12px', color: '#444' }}>
                          {group.groupId}
                        </td>
                        <td style={{ padding: '12px', color: '#24292e' }}>{group.groupName}</td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#444' }}>{group.leaderId}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            backgroundColor: group.status === 'active' ? '#dcffe4' : group.status === 'pending_validation' ? '#fff3cd' : '#f1f8ff',
                            color: group.status === 'active' ? '#22863a' : group.status === 'pending_validation' ? '#856404' : '#0366d6',
                          }}>
                            {group.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#444' }}>{group.memberCount}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: group.githubConnected ? '#28a745' : '#e0e0e0',
                            color: group.githubConnected ? 'white' : '#666',
                          }}>
                            {group.githubConnected ? '✓' : '✗'}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: group.jiraConnected ? '#0366d6' : '#e0e0e0',
                            color: group.jiraConnected ? 'white' : '#666',
                          }}>
                            {group.jiraConnected ? '✓' : '✗'}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          {(group.groupId || group._id) ? (
                            <>
                              <Link
                                to={`/groups/${group.groupId || group._id}/final-grades/approval`}
                                style={{
                                  display: 'inline-block',
                                  padding: '4px 8px',
                                  backgroundColor: '#0366d6',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  marginRight: '6px',
                                  textDecoration: 'none'
                                }}
                              >
                                Review
                              </Link>
                              <Link
                                to={`/groups/${group.groupId || group._id}/final-grades/publish`}
                                style={{
                                  display: 'inline-block',
                                  padding: '4px 8px',
                                  backgroundColor: '#4f46e5',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  textDecoration: 'none'
                                }}
                              >
                                Publish
                              </Link>
                            </>
                          ) : (
                            <span style={{ color: '#999', fontSize: '11px' }}>Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ──── TRANSFER TAB ──── */}
        {activeTab === 'transfer' && (
          <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', color: '#24292e' }}>Coordinator Transfer (3.6)</h2>
            <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
              Reassign a group to a new advisor. This bypasses the standard advisee request flow.
            </p>

            <form onSubmit={handleTransferSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label htmlFor="tr-groupId" style={labelStyle}>Group</label>
                  <select
                    id="tr-groupId"
                    name="groupId"
                    value={transferForm.groupId}
                    onChange={handleTransferFormChange}
                    style={inputStyle}
                    required
                  >
                    <option value="">-- Choose a group --</option>
                    {validGroups.map((g, idx) => (
                      <option key={`transfer-group-${idx}-${g.groupId || g._id || 'unknown'}`} value={g.groupId || ''}>
                        {g.groupName} ({g.groupId}) {g.advisorId ? `- current: ${g.advisorId}` : '- no advisor'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tr-newProfessorId" style={labelStyle}>New Professor</label>
                  <select
                    id="tr-newProfessorId"
                    name="newProfessorId"
                    value={transferForm.newProfessorId}
                    onChange={handleTransferFormChange}
                    style={inputStyle}
                    required
                  >
                    <option value="">-- Choose a professor --</option>
                    {professors.length === 0 && !professorsLoading && (
                      <option disabled>No professors available</option>
                    )}
                    {professorsLoading && (
                      <option disabled>Loading professors…</option>
                    )}
                    {professors.map((prof, idx) => (
                      <option key={`prof-${idx}-${prof.userId}`} value={prof.userId}>
                        {prof.name || prof.email} ({prof.userId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="tr-reason" style={labelStyle}>Reason (optional)</label>
                <textarea
                  id="tr-reason"
                  name="reason"
                  value={transferForm.reason}
                  onChange={handleTransferFormChange}
                  placeholder="Reason for transfer (audit trail)"
                  rows="3"
                  style={{ ...inputStyle, fontFamily: 'inherit' }}
                />
              </div>

              {transferError && <p style={{ color: '#d73a49', fontSize: '14px', marginBottom: '12px' }}>{transferError}</p>}
              {transferSuccess && <p style={{ color: '#22863a', fontSize: '14px', marginBottom: '12px' }}>{transferSuccess}</p>}

              <button
                type="submit"
                disabled={transferSubmitting}
                style={{
                  padding: '10px 20px',
                  backgroundColor: transferSubmitting ? '#ccc' : '#0366d6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: transferSubmitting ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                {transferSubmitting ? 'Transferring…' : 'Transfer Advisor'}
              </button>
            </form>
          </section>
        )}

        {/* ──── OVERRIDES TAB ──── */}
        {activeTab === 'overrides' && (
          <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', color: '#24292e' }}>Override Actions</h2>
            <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
              Perform administrative overrides: add/remove members or update group fields.
            </p>

            <form onSubmit={handleOverrideSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label htmlFor="ov-group" style={labelStyle}>Select Group</label>
                  <select
                    id="ov-group"
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    style={inputStyle}
                    required
                  >
                    <option value="">-- Choose a group --</option>
                    {validGroups.map((g, idx) => (
                      <option key={`override-group-${idx}-${g.groupId || g._id || 'unknown'}`} value={g.groupId || ''}>
                        {g.groupName} ({g.groupId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ov-action" style={labelStyle}>Action Type</label>
                  <select
                    id="ov-action"
                    name="action"
                    value={overrideForm.action}
                    onChange={handleOverrideFormChange}
                    style={inputStyle}
                  >
                    <option value="add_member">Add Member</option>
                    <option value="remove_member">Remove Member</option>
                    <option value="update_group">Update Group</option>
                  </select>
                </div>
              </div>

              {(overrideForm.action === 'add_member' || overrideForm.action === 'remove_member') && (
                <div style={{ marginBottom: '16px' }}>
                  <label htmlFor="ov-student" style={labelStyle}>
                    {overrideForm.action === 'remove_member' ? 'Student to Remove' : 'Student ID'}
                  </label>
                  {!selectedGroupId ? (
                    <select disabled style={inputStyle}>
                      <option>-- Select a group first --</option>
                    </select>
                  ) : overrideForm.action === 'remove_member' ? (
                    <select
                      id="ov-student"
                      name="targetStudentId"
                      value={overrideForm.targetStudentId}
                      onChange={handleOverrideFormChange}
                      style={inputStyle}
                      required
                      disabled={groupMembersLoading}
                    >
                      <option value="">
                        {groupMembersLoading ? 'Loading members…' : '-- Choose a member --'}
                      </option>
                      {!groupMembersLoading && groupMembers.length === 0 && (
                        <option disabled>No members found in this group</option>
                      )}
                      {groupMembers.map((member, idx) => (
                        <option key={`member-${idx}-${member.userId}`} value={member.userId}>
                          {member.userId}{member.email ? ` — ${member.email}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="ov-student"
                      name="targetStudentId"
                      type="text"
                      value={overrideForm.targetStudentId}
                      onChange={handleOverrideFormChange}
                      placeholder="Enter student user ID"
                      style={inputStyle}
                      required
                    />
                  )}
                </div>
              )}

              {overrideForm.action === 'update_group' && (
                <div style={{ marginBottom: '16px' }}>
                  <label htmlFor="ov-updates" style={labelStyle}>Updates (JSON format)</label>
                  <textarea
                    id="ov-updates"
                    placeholder='{"groupName": "New Name"}'
                    style={{ ...inputStyle, fontFamily: '\"SF Mono\", Monaco, monospace', fontSize: '12px' }}
                    rows="4"
                    onChange={(e) => {
                      try {
                        const updates = e.target.value.trim() ? JSON.parse(e.target.value) : {};
                        setOverrideForm((prev) => ({ ...prev, updates }));
                      } catch (err) {
                        // Invalid JSON, don't update
                      }
                    }}
                  />
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="ov-reason" style={labelStyle}>Reason</label>
                <textarea
                  id="ov-reason"
                  name="reason"
                  value={overrideForm.reason}
                  onChange={handleOverrideFormChange}
                  placeholder="Explain the reason for this override"
                  style={{ ...inputStyle, fontFamily: 'inherit' }}
                  rows="3"
                  required
                />
              </div>

              {overrideError && <p style={{ color: '#d73a49', fontSize: '14px', marginBottom: '12px' }}>{overrideError}</p>}
              {overrideSuccess && <p style={{ color: '#22863a', fontSize: '14px', marginBottom: '12px' }}>{overrideSuccess}</p>}

              <button
                type="submit"
                disabled={overrideSubmitting}
                style={{
                  padding: '10px 20px',
                  backgroundColor: overrideSubmitting ? '#ccc' : '#0366d6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: overrideSubmitting ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                {overrideSubmitting ? 'Processing…' : 'Execute Override'}
              </button>
            </form>
          </section>
        )}

        {/* ──── SCHEDULE WINDOWS TAB ──── */}
        {activeTab === 'schedule' && (
          <>
            <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
              <h2 style={{ marginTop: 0, fontSize: '18px', color: '#24292e' }}>Configure Schedule Window</h2>
              <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
                Set the open and close times for group formation operations.
              </p>

              <form onSubmit={handleScheduleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label htmlFor="sw-operationType" style={labelStyle}>Operation Type</label>
                    <select
                      id="sw-operationType"
                      name="operationType"
                      value={scheduleForm.operationType}
                      onChange={handleScheduleFormChange}
                      style={inputStyle}
                    >
                      {OPERATION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sw-label" style={labelStyle}>Label (optional)</label>
                    <input
                      id="sw-label"
                      name="label"
                      type="text"
                      value={scheduleForm.label}
                      onChange={handleScheduleFormChange}
                      placeholder="e.g. Spring 2026 – Group Creation"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label htmlFor="sw-startsAt" style={labelStyle}>Open At (your local time → UTC)</label>
                    <input
                      id="sw-startsAt"
                      name="startsAt"
                      type="datetime-local"
                      value={scheduleForm.startsAt}
                      onChange={handleScheduleFormChange}
                      style={inputStyle}
                      required
                      title="Enter time in your local timezone; it will be converted to UTC for storage"
                    />
                  </div>

                  <div>
                    <label htmlFor="sw-endsAt" style={labelStyle}>Close At (your local time → UTC)</label>
                    <input
                      id="sw-endsAt"
                      name="endsAt"
                      type="datetime-local"
                      value={scheduleForm.endsAt}
                      onChange={handleScheduleFormChange}
                      style={inputStyle}
                      required
                      title="Enter time in your local timezone; it will be converted to UTC for storage"
                    />
                  </div>
                </div>

                {scheduleError && <p style={{ color: '#d73a49', fontSize: '14px', marginBottom: '12px' }}>{scheduleError}</p>}
                {scheduleSuccess && <p style={{ color: '#22863a', fontSize: '14px', marginBottom: '12px' }}>{scheduleSuccess}</p>}

                <button
                  type="submit"
                  disabled={scheduleSubmitting}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: scheduleSubmitting ? '#ccc' : '#0366d6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: scheduleSubmitting ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                  }}
                >
                  {scheduleSubmitting ? 'Saving…' : 'Create Window'}
                </button>
              </form>
            </section>

            <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
              <h2 style={{ marginTop: 0, fontSize: '18px', color: '#24292e' }}>Active Windows</h2>

              {windowsLoading && <p style={{ color: '#666' }}>Loading…</p>}
              {windowsError && <p style={{ color: '#d73a49' }}>{windowsError}</p>}

              {!windowsLoading && activeWindows.length === 0 && (
                <p style={{ color: '#666', fontSize: '14px' }}>No active schedule windows. All operations are currently blocked.</p>
              )}

              {activeWindows.map((w) => {
                const typeLabel = OPERATION_TYPES.find((t) => t.value === w.operationType)?.label ?? w.operationType;
                const now = new Date();
                const isOpen = w.isActive && new Date(w.startsAt) <= now && new Date(w.endsAt) >= now;

                return (
                  <div key={w.windowId} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: '1px solid #e1e4e8',
                  }}>
                    <div>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        marginRight: '10px',
                        backgroundColor: isOpen ? '#dcffe4' : '#f1f8ff',
                        color: isOpen ? '#22863a' : '#0366d6',
                      }}>
                        {typeLabel}
                      </span>
                      {w.label && <span style={{ fontSize: '14px', fontWeight: '600', marginRight: '8px' }}>{w.label}</span>}
                      <span style={{ fontSize: '13px', color: '#586069' }}>
                        {new Date(w.startsAt).toLocaleString()} → {new Date(w.endsAt).toLocaleString()}
                      </span>
                      {isOpen && (
                        <span style={{ marginLeft: '10px', fontSize: '12px', color: '#22863a', fontWeight: '600' }}>● Open</span>
                      )}
                    </div>

                    {w.isActive && (
                      <button
                        onClick={() => handleDeactivateWindow(w.windowId)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#fafbfc',
                          border: '1px solid #d1d5da',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          color: '#d73a49',
                          flexShrink: 0,
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                );
              })}
            </section>

            {inactiveWindows.length > 0 && (
              <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h2 style={{ marginTop: 0, fontSize: '18px', color: '#666' }}>Past / Deactivated Windows</h2>
                {inactiveWindows.map((w) => {
                  const typeLabel = OPERATION_TYPES.find((t) => t.value === w.operationType)?.label ?? w.operationType;
                  return (
                    <div key={w.windowId} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 0',
                      borderBottom: '1px solid #e1e4e8',
                    }}>
                      <div>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          marginRight: '10px',
                          backgroundColor: '#f1f8ff',
                          color: '#0366d6',
                        }}>
                          {typeLabel}
                        </span>
                        {w.label && <span style={{ fontSize: '14px', fontWeight: '600', marginRight: '8px' }}>{w.label}</span>}
                        <span style={{ fontSize: '13px', color: '#586069' }}>
                          {new Date(w.startsAt).toLocaleString()} → {new Date(w.endsAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}

        {/* ──── INTEGRATION HEALTH TAB ──── */}
        {activeTab === 'health' && (
          <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', color: '#24292e' }}>Integration Health Overview</h2>

            {groupsLoading && <p style={{ color: '#666' }}>Loading…</p>}
            {groupsError && <p style={{ color: '#d73a49' }}>{groupsError}</p>}

            {!groupsLoading && validGroups.length === 0 && (
              <p style={{ color: '#666', fontSize: '14px' }}>No groups found.</p>
            )}

            {!groupsLoading && validGroups.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {validGroups.map((group) => {
                  const health = getIntegrationHealthClass(group);
                  const hasErrors = group.integrationErrors && group.integrationErrors.length > 0;

                  return (
                    <div key={`health-card-${group.groupId || group._id || 'unknown'}`} style={{
                      border: '1px solid #e1e4e8',
                      borderRadius: '8px',
                      padding: '16px',
                      backgroundColor: health === 'healthy' ? '#f0f9ff' : health === 'partial' ? '#fffbf0' : health === 'error' ? '#fff5f5' : '#f6f8fa',
                      borderLeft: `4px solid ${health === 'healthy' ? '#28a745' : health === 'partial' ? '#ffc107' : health === 'error' ? '#dc3545' : '#e1e4e8'}`,
                    }}>
                      <div style={{ marginBottom: '12px' }}>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: '600', color: '#24292e' }}>{group.groupName}</h3>
                        <p style={{ margin: '0', fontSize: '12px', color: '#444' }}>{group.groupId}</p>
                      </div>

                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: group.githubConnected ? '#28a745' : '#e0e0e0',
                            marginRight: '8px',
                          }} />
                          <span style={{ fontSize: '13px', fontWeight: '500', color: '#444' }}>GitHub: {group.githubConnected ? 'Connected' : 'Not Connected'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: group.jiraConnected ? '#0366d6' : '#e0e0e0',
                            marginRight: '8px',
                          }} />
                          <span style={{ fontSize: '13px', fontWeight: '500', color: '#444' }}>JIRA: {group.jiraConnected ? 'Connected' : 'Not Connected'}</span>
                        </div>
                      </div>

                      {hasErrors && (
                        <div style={{ borderTop: '1px solid #e1e4e8', paddingTop: '12px' }}>
                          <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '600', color: '#dc3545' }}>Recent Errors:</p>
                          {group.integrationErrors.slice(0, 3).map((err, idx) => (
                            <div key={`integration-error-${group.groupId || 'unknown'}-${idx}-${err.service || 'service'}`} style={{ fontSize: '11px', color: '#24292e', marginBottom: '4px' }}>
                              <span style={{ fontWeight: '600', color: '#24292e' }}>{err.service}:</span> <span style={{ color: '#444' }}>{err.lastError}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ──── COMMITTEES TAB ──── */}
        {activeTab === 'committees' && (
          <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: '4px', fontSize: '18px', color: '#24292e' }}>Committees</h2>
                <p style={{ margin: 0, fontSize: '13px', color: '#586069' }}>
                  Process 4.1 — Create and manage committee drafts. Drafts are forwarded to Process 4.2 for advisor assignment.
                </p>
              </div>
              <button
                id="coordinator-new-committee-btn"
                onClick={() => navigate('/coordinator/committees/new')}
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#0366d6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  flexShrink: 0,
                  marginLeft: '16px',
                }}
              >
                + New Committee
              </button>
            </div>

            {committeesLoading && <p style={{ color: '#666' }}>Loading committees…</p>}
            {committeesError && <p style={{ color: '#d73a49' }}>{committeesError}</p>}

            {!committeesLoading && committees.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <p style={{ fontSize: '14px', color: '#666', margin: '0 0 12px' }}>
                  No committees created yet.
                </p>
                <button
                  id="coordinator-committees-empty-btn"
                  onClick={() => navigate('/coordinator/committees/new')}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#0366d6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                  }}
                >
                  Create First Committee
                </button>
              </div>
            )}

            {!committeesLoading && committees.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e4e8', backgroundColor: '#f6f8fa' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Committee ID</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Name</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Description</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Advisors</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Jury</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Created</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#24292e' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {committees.map((c, idx) => (
                      <tr key={`committee-row-${idx}-${c.committeeId || c._id || 'unknown'}`} style={{ borderBottom: '1px solid #e1e4e8' }}>
                        <td style={{ padding: '12px', fontFamily: '"SF Mono", Monaco, monospace', fontSize: '12px', color: '#444' }}>
                          {c.committeeId}
                        </td>
                        <td style={{ padding: '12px', color: '#24292e', fontWeight: '500' }}>{c.committeeName}</td>
                        <td style={{ padding: '12px', color: '#586069', fontSize: '12px', maxWidth: '200px' }}>
                          {c.description ? (
                            <span title={c.description}>
                              {c.description.length > 60 ? c.description.substring(0, 60) + '…' : c.description}
                            </span>
                          ) : (
                            <span style={{ color: '#ccc', fontStyle: 'italic' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            backgroundColor: c.status === 'draft' ? '#fff3cd' : c.status === 'validated' ? '#dcffe4' : '#f1f8ff',
                            color: c.status === 'draft' ? '#856404' : c.status === 'validated' ? '#22863a' : '#0366d6',
                          }}>
                            {c.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#444' }}>
                          {c.advisorIds && c.advisorIds.length > 0 ? (
                            <span title={c.advisorIds.join(', ')}>{c.advisorIds.length}</span>
                          ) : (
                            <span style={{ color: '#ccc', fontStyle: 'italic' }}>none</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', color: '#444' }}>
                          {c.juryIds && c.juryIds.length > 0 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title={c.juryIds.join(', ')}>
                              {c.juryIds.length}
                              {c.forwardedToJuryValidation && (
                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: '#dcffe4', color: '#22863a', fontWeight: '600' }}>
                                  → 4.4
                                </span>
                              )}
                            </span>
                          ) : (
                            <span style={{ color: '#ccc', fontStyle: 'italic' }}>none yet</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', color: '#586069', fontSize: '12px' }}>
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {(c.committeeId || c._id) ? (
                            <Link
                              id={`committee-assign-jury-btn-${c.committeeId || c._id}`}
                              to={`/coordinator/committees/${c.committeeId || c._id}/jury`}
                              style={{
                                display: 'inline-block',
                                padding: '5px 12px',
                                backgroundColor: '#f1f8ff',
                                border: '1px solid #0366d6',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '600',
                                color: '#0366d6',
                                whiteSpace: 'nowrap',
                                textDecoration: 'none'
                              }}
                            >
                              ⚖️ Assign Jury
                            </Link>
                          ) : (
                            <span style={{ color: '#999', fontSize: '11px' }}>Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Confirmation Dialog */}
        {confirmDialogOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '400px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '18px', color: '#24292e' }}>
                Confirm Removal
              </h3>
              <p style={{ color: '#586069', marginBottom: '24px' }}>
                {confirmDialogMessage}
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setConfirmDialogOpen(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#fafbfc',
                    border: '1px solid #d1d5da',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#24292e',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={executeOverride}
                  disabled={overrideSubmitting}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: overrideSubmitting ? '#ccc' : '#d73a49',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: overrideSubmitting ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'white',
                  }}
                >
                  {overrideSubmitting ? 'Removing…' : 'Remove Student'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CoordinatorPanel;
