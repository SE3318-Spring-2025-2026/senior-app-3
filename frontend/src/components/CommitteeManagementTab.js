import React, { useEffect, useState } from 'react';
import useAuthStore from '../store/authStore';
import {
  createCommittee,
  listCommittees,
  listCommitteeCandidates,
  assignCommitteeAdvisors,
  addJuryMembers,
  validateCommitteeSetup,
  publishCommittee,
} from '../api/committeeService';

const CommitteeManagementTab = () => {
  const user = useAuthStore((state) => state.user);
  const [committees, setCommittees] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedCommitteeId, setSelectedCommitteeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [createForm, setCreateForm] = useState({ committeeName: '', description: '' });
  const [createError, setCreateError] = useState('');
  const [assignError, setAssignError] = useState('');
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [advisorSelection, setAdvisorSelection] = useState([]);
  const [jurySelection, setJurySelection] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedCommittee = committees.find((committee) => committee.committeeId === selectedCommitteeId);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedCommittee) {
      setAdvisorSelection(selectedCommittee.advisorIds || []);
      setJurySelection(selectedCommittee.juryIds || []);
      setValidationResult(null);
      setValidationError('');
      setAssignError('');
      setPublishError('');
    }
  }, [selectedCommittee]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [committeesResponse, candidateResponse] = await Promise.all([
        listCommittees(),
        listCommitteeCandidates(),
      ]);

      const returnedCommittees = committeesResponse.committees || [];
      setCommittees(returnedCommittees);
      setCandidates(candidateResponse.professors || []);
      if (!selectedCommitteeId && returnedCommittees.length > 0) {
        setSelectedCommitteeId(returnedCommittees[0].committeeId);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load committees.');
    } finally {
      setLoading(false);
    }
  };

  const refreshCommittees = async (keepCommitteeId) => {
    try {
      const committeesResponse = await listCommittees();
      const returnedCommittees = committeesResponse.committees || [];
      setCommittees(returnedCommittees);
      if (keepCommitteeId && returnedCommittees.some((c) => c.committeeId === keepCommitteeId)) {
        setSelectedCommitteeId(keepCommitteeId);
      } else if (returnedCommittees.length > 0) {
        setSelectedCommitteeId(returnedCommittees[0].committeeId);
      } else {
        setSelectedCommitteeId('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to refresh committees.');
    }
  };

  const handleCreateFormChange = (e) => {
    const { name, value } = e.target;
    setCreateForm((prev) => ({ ...prev, [name]: value }));
    setCreateError('');
    setInfoMessage('');
  };

  const handleCreateCommittee = async (e) => {
    e.preventDefault();
    setCreateError('');
    setInfoMessage('');

    if (!createForm.committeeName.trim()) {
      setCreateError('Committee name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createCommittee({
        committeeName: createForm.committeeName.trim(),
        description: createForm.description.trim(),
        coordinatorId: user?.userId,
      });

      setInfoMessage(`Committee "${result.committeeName}" created successfully.`);
      setCreateForm({ committeeName: '', description: '' });
      await refreshCommittees(result.committeeId);
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to create committee.';
      setCreateError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCommitteeCandidates = candidates.map((candidate) => ({
    ...candidate,
    label: candidate.email,
  }));

  const handleAdvisorSelection = (e) => {
    const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
    setAdvisorSelection(selected);
    setValidationResult(null);
    setAssignError('');
    setPublishError('');
  };

  const handleJurySelection = (e) => {
    const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
    setJurySelection(selected);
    setValidationResult(null);
    setAssignError('');
    setPublishError('');
  };

  const handleAssignAdvisors = async () => {
    if (!selectedCommittee) return;
    if (!advisorSelection.length) {
      setAssignError('Please select at least one advisor.');
      return;
    }
    setAssignError('');
    setPublishError('');
    setSubmitting(true);

    try {
      await assignCommitteeAdvisors(selectedCommittee.committeeId, advisorSelection);
      setInfoMessage('Advisor assignments updated. Please validate before publishing.');
      await refreshCommittees(selectedCommittee.committeeId);
    } catch (err) {
      setAssignError(err.response?.data?.message || 'Failed to assign advisors.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignJuryMembers = async () => {
    if (!selectedCommittee) return;
    if (!jurySelection.length) {
      setAssignError('Please select at least one jury member.');
      return;
    }
    setAssignError('');
    setPublishError('');
    setSubmitting(true);

    try {
      await addJuryMembers(selectedCommittee.committeeId, jurySelection);
      setInfoMessage('Jury assignments updated. Please validate before publishing.');
      await refreshCommittees(selectedCommittee.committeeId);
    } catch (err) {
      setAssignError(err.response?.data?.message || 'Failed to assign jury members.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidateCommittee = async () => {
    if (!selectedCommittee) return;
    setValidationError('');
    setInfoMessage('');
    setSubmitting(true);

    try {
      const result = await validateCommitteeSetup(selectedCommittee.committeeId);
      setValidationResult(result);
      if (result.valid) {
        setInfoMessage('Committee setup is valid and ready to publish.');
      }
    } catch (err) {
      setValidationError(err.response?.data?.message || 'Failed to validate committee.');
    } finally {
      setSubmitting(false);
      await refreshCommittees(selectedCommittee.committeeId);
    }
  };

  const handlePublishCommittee = async () => {
    if (!selectedCommittee) return;
    setPublishError('');
    setInfoMessage('');

    const confirmation = window.confirm('Publish this committee? This action cannot be undone.');
    if (!confirmation) return;

    setSubmitting(true);
    try {
      await publishCommittee(selectedCommittee.committeeId);
      setInfoMessage('Committee published successfully.');
      setValidationResult(null);
      await refreshCommittees(selectedCommittee.committeeId);
    } catch (err) {
      const body = err.response?.data;
      if (body?.missingRequirements) {
        setValidationResult({
          valid: false,
          missingRequirements: body.missingRequirements,
          checkedAt: new Date().toISOString(),
        });
      }
      setPublishError(err.response?.data?.message || 'Failed to publish committee.');
    } finally {
      setSubmitting(false);
    }
  };

  const committeeRows = committees.map((committee) => (
    <tr
      key={committee.committeeId}
      style={{
        backgroundColor: committee.committeeId === selectedCommitteeId ? '#f6fbff' : 'transparent',
      }}
    >
      <td style={{ padding: '12px' }}>{committee.committeeName}</td>
      <td style={{ padding: '12px' }}>{committee.status}</td>
      <td style={{ padding: '12px' }}>{committee.advisorIds?.length ?? 0}</td>
      <td style={{ padding: '12px' }}>{committee.juryIds?.length ?? 0}</td>
      <td style={{ padding: '12px' }}>{new Date(committee.createdAt).toLocaleDateString()}</td>
      <td style={{ padding: '12px' }}>
        <button
          type="button"
          onClick={() => setSelectedCommitteeId(committee.committeeId)}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid #0366d6',
            backgroundColor: committee.committeeId === selectedCommitteeId ? '#0366d6' : 'white',
            color: committee.committeeId === selectedCommitteeId ? 'white' : '#0366d6',
            cursor: 'pointer',
          }}
        >
          Select
        </button>
      </td>
    </tr>
  ));

  const canPublish = selectedCommittee && selectedCommittee.status !== 'published' && (validationResult?.valid || selectedCommittee.status === 'validated');

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      <section style={{ background: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ marginTop: 0 }}>Create Committee Draft</h2>
        <form onSubmit={handleCreateCommittee}>
          <div style={{ display: 'grid', gap: '16px', maxWidth: '560px' }}>
            <label style={{ fontWeight: 600 }}>
              Committee Name
              <input
                name="committeeName"
                value={createForm.committeeName}
                onChange={handleCreateFormChange}
                placeholder="Enter committee name"
                style={{ width: '100%', marginTop: '8px', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5da' }}
              />
            </label>
            <label style={{ fontWeight: 600 }}>
              Description (optional)
              <textarea
                name="description"
                value={createForm.description}
                onChange={handleCreateFormChange}
                placeholder="Describe the committee purpose"
                rows={3}
                style={{ width: '100%', marginTop: '8px', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5da' }}
              />
            </label>
            {createError && <div style={{ color: '#d73a49', fontSize: '14px' }}>{createError}</div>}
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '10px 18px',
                backgroundColor: '#0366d6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                width: 'fit-content',
              }}
            >
              {submitting ? 'Creating…' : 'Create Committee Draft'}
            </button>
          </div>
        </form>
      </section>

      <section style={{ display: 'grid', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Committee List</h2>
          <button
            type="button"
            onClick={loadData}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #d1d5da',
              background: 'white',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
        {loading && <p>Loading committees…</p>}
        {error && <p style={{ color: '#d73a49' }}>{error}</p>}
        {!loading && committees.length === 0 && <p style={{ color: '#666' }}>No committees created yet.</p>}
        {!loading && committees.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f6f8fa' }}>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Advisors</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Jury</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Created</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}></th>
                </tr>
              </thead>
              <tbody>{committeeRows}</tbody>
            </table>
          </div>
        )}
      </section>

      {selectedCommittee ? (
        <section style={{ background: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ marginTop: 0 }}>Selected Committee</h2>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
            <div><strong>Name:</strong> {selectedCommittee.committeeName}</div>
            {selectedCommittee.description && <div><strong>Description:</strong> {selectedCommittee.description}</div>}
            <div><strong>Status:</strong> {selectedCommittee.status}</div>
            <div><strong>Advisors:</strong> {selectedCommittee.advisorIds.length}</div>
            <div><strong>Jury:</strong> {selectedCommittee.juryIds.length}</div>
          </div>

          <div style={{ display: 'grid', gap: '24px', marginBottom: '24px' }}>
            <div>
              <h3 style={{ marginBottom: '12px' }}>Assign Advisors</h3>
              <select
                multiple
                size={6}
                value={advisorSelection}
                onChange={handleAdvisorSelection}
                style={{ width: '100%', minHeight: '180px', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5da' }}
              >
                {selectedCommitteeCandidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId} disabled={jurySelection.includes(candidate.userId)}>
                    {candidate.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAssignAdvisors}
                disabled={submitting}
                style={{
                  marginTop: '12px',
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#0366d6',
                  color: 'white',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Saving…' : 'Save Advisors'}
              </button>
            </div>

            <div>
              <h3 style={{ marginBottom: '12px' }}>Assign Jury Members</h3>
              <select
                multiple
                size={6}
                value={jurySelection}
                onChange={handleJurySelection}
                style={{ width: '100%', minHeight: '180px', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5da' }}
              >
                {selectedCommitteeCandidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId} disabled={advisorSelection.includes(candidate.userId)}>
                    {candidate.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAssignJuryMembers}
                disabled={submitting}
                style={{
                  marginTop: '12px',
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#0366d6',
                  color: 'white',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Saving…' : 'Save Jury'}
              </button>
            </div>
          </div>

          {assignError && (
            <div style={{ color: '#d73a49', marginBottom: '16px' }}>{assignError}</div>
          )}

          <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
            <h3 style={{ marginBottom: '12px' }}>Validation</h3>
            <button
              type="button"
              onClick={handleValidateCommittee}
              disabled={submitting}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#28a745',
                color: 'white',
                cursor: submitting ? 'not-allowed' : 'pointer',
                width: 'fit-content',
              }}
            >
              {submitting ? 'Validating…' : 'Validate Committee'}
            </button>
            {validationError && <div style={{ color: '#d73a49' }}>{validationError}</div>}
            {validationResult && (
              <div style={{
                padding: '16px',
                borderRadius: '10px',
                background: validationResult.valid ? '#e6ffed' : '#fff5f5',
                border: validationResult.valid ? '1px solid #28a745' : '1px solid #d73a49',
              }}>
                <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                  Validation: {validationResult.valid ? 'Valid' : 'Invalid'}
                </div>
                {validationResult.missingRequirements?.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {validationResult.missingRequirements.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div>No missing requirements.</div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!canPublish || submitting}
              onClick={handlePublishCommittee}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: canPublish ? '#6f42c1' : '#d1d5da',
                color: canPublish ? 'white' : '#666',
                cursor: canPublish && !submitting ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? 'Publishing…' : 'Publish Committee'}
            </button>
            {selectedCommittee.status === 'published' && (
              <span style={{ color: '#22863a', fontWeight: 600 }}>Already published</span>
            )}
            {publishError && <span style={{ color: '#d73a49' }}>{publishError}</span>}
          </div>
        </section>
      ) : (
        <section style={{ background: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <p style={{ color: '#666' }}>Select or create a committee draft to begin assignment and validation.</p>
        </section>
      )}

      {infoMessage && <div style={{ padding: '16px', borderRadius: '10px', background: '#e6ffed', border: '1px solid #28a745', color: '#24292e' }}>{infoMessage}</div>}
    </div>
  );
};

export default CommitteeManagementTab;
