import React, { useEffect, useMemo, useState } from 'react';
import { getScheduleWindow } from '../api/groupService';
import { getGroupDeliverables, submitDeliverableStaging } from '../api/deliverableService';

const DELIVERABLE_TYPES = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'statement_of_work', label: 'Statement of Work' },
  { value: 'demo', label: 'Demo' },
  { value: 'interim_report', label: 'Interim Report' },
  { value: 'final_report', label: 'Final Report' },
];

const DeliverableSubmissionForm = ({
  groupId,
  sprintId: sprintIdProp,
  isLeader,
  userId,
  members,
  committeeStatus,
  onSuccess,
}) => {
  const [selectedType, setSelectedType] = useState('proposal');
  const [sprintId, setSprintId] = useState(sprintIdProp || '');
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [windowOpen, setWindowOpen] = useState(false);
  const [windowInfo, setWindowInfo] = useState(null);
  const [loadingWindow, setLoadingWindow] = useState(true);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submittedDeliverables, setSubmittedDeliverables] = useState({});

  const isGroupMember = useMemo(() => {
    if (!members || !Array.isArray(members)) return false;
    return members.some((m) => m.userId === userId || m.user_id === userId);
  }, [members, userId]);

  const isPublished = committeeStatus === 'published' || committeeStatus === 'Published';
  const canSubmit = isLeader && isPublished;

  useEffect(() => {
    const fetchWindowAndSubmissions = async () => {
      setLoadingWindow(true);
      try {
        const schedule = await getScheduleWindow('deliverable_submission');
        setWindowOpen(Boolean(schedule.open));
        setWindowInfo(schedule.window || null);
      } catch {
        setWindowOpen(false);
        setWindowInfo(null);
      }

      try {
        const data = await getGroupDeliverables(groupId);
        const deliverables = data.deliverables || data.items || data.data || [];
        const byType = {};
        if (Array.isArray(deliverables)) {
          deliverables.forEach((d) => { byType[d.type] = d; });
        }
        setSubmittedDeliverables(byType);
      } catch {
        setSubmittedDeliverables({});
      } finally {
        setLoadingWindow(false);
      }
    };

    fetchWindowAndSubmissions();
  }, [groupId]);

  const resetForm = () => {
    setFile(null);
    setDescription('');
    setSelectedType('proposal');
    setSprintId(sprintIdProp || '');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!file) {
      setErrorMsg('Please select a file to upload.');
      return;
    }

    if (!sprintId) {
      setErrorMsg('No sprint ID provided. Contact your coordinator.');
      return;
    }

    setLoadingSubmit(true);

    try {
      const result = await submitDeliverableStaging(groupId, {
        deliverableType: selectedType,
        sprintId,
        file,
        description: description.trim() || undefined,
      });

      setSubmittedDeliverables((prev) => ({
        ...prev,
        [selectedType]: result,
      }));
      resetForm();
      setSuccessMsg(`Deliverable staged successfully. ID: ${result.stagingId}`);
      if (onSuccess) onSuccess(result);
    } catch (error) {
      const status = error.response?.status ?? error.status;
      const code = error.response?.data?.code ?? error.code;
      const message = error.response?.data?.message ?? error.message;

      if (status === 403 || code === 'FORBIDDEN' || code === 'GROUP_ID_MISMATCH') {
        setErrorMsg('Group validation failed. Make sure your group is active and has a committee assigned.');
      } else if (status === 409) {
        setErrorMsg(message || 'Group is not eligible to submit deliverables.');
      } else if (status === 413) {
        setErrorMsg('File is too large. Maximum size is 1 GB.');
      } else if (status === 415) {
        setErrorMsg('Unsupported file type. Please upload a PDF, DOCX, Markdown, or ZIP file.');
      } else if (status === 429) {
        setErrorMsg('Too many submissions. Please wait a few minutes before trying again.');
      } else {
        setErrorMsg(message || 'Could not submit your deliverable. Please try again.');
      }
    } finally {
      setLoadingSubmit(false);
    }
  };

  const renderExistingSubmissions = () => {
    const submitted = Object.entries(submittedDeliverables);
    if (submitted.length === 0) return null;

    return (
      <div className="deliverable-submissions-container">
        {submitted.map(([typeKey, data]) => (
          <div key={typeKey} className="deliverable-card">
            <div className="deliverable-card-header">
              <h3>{typeKey.replace(/_/g, ' ')} Deliverable</h3>
              <span className="status-badge connected">Submitted</span>
            </div>
            <div className="deliverable-card-content">
              <div className="info-row">
                <span className="info-label">Staging ID</span>
                <span className="info-value">{data.stagingId || data.deliverableId || data.id || 'N/A'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Submitted At</span>
                <span className="info-value">
                  {data.submittedAt ? new Date(data.submittedAt).toLocaleString() : 'N/A'}
                </span>
              </div>
              {data.fileHash && (
                <div className="info-row">
                  <span className="info-label">File Hash (SHA-256)</span>
                  <span className="info-value" style={{ wordBreak: 'break-all', fontSize: '0.8em' }}>
                    {data.fileHash}
                  </span>
                </div>
              )}
            </div>
            {isLeader && windowOpen && (
              <button
                type="button"
                className="add-member-btn"
                onClick={() => setSelectedType(typeKey)}
              >
                Re-submit as {typeKey.replace(/_/g, ' ')}
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="deliverable-section">
      <div className="members-header">
        <h3>Deliverable Submission</h3>
      </div>

      {!isPublished && (
        <div className="deliverable-locked-card">
          <p>
            Deliverable submission is locked until the committee assignment is published.
            Once published, the team leader can submit deliverables.
          </p>
        </div>
      )}

      {isPublished && loadingWindow && (
        <div className="deliverable-status-message">Checking submission window…</div>
      )}

      {isPublished && !loadingWindow && (
        <>
          {renderExistingSubmissions()}

          {!isGroupMember && (
            <div className="deliverable-locked-card">
              <p>You can view deliverable status in read-only mode. Only the team leader can submit.</p>
            </div>
          )}

          {isLeader && (
            <>
              {!windowOpen && (
                <div className="deliverable-closed-banner">
                  <strong>Submission window closed.</strong>
                  {windowInfo?.endsAt && ` Next window: ${new Date(windowInfo.endsAt).toLocaleString()}`}
                </div>
              )}

              <form className="deliverable-form" onSubmit={handleSubmit}>
                <div className="deliverable-form-row">
                  <label htmlFor="deliverable-type">Deliverable Type</label>
                  <select
                    id="deliverable-type"
                    className="deliverable-select"
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    disabled={!windowOpen || loadingSubmit}
                  >
                    {DELIVERABLE_TYPES.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}{submittedDeliverables[value] ? ' (Re-submit)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="deliverable-form-row">
                  <label htmlFor="deliverable-sprint">Sprint ID</label>
                  <input
                    id="deliverable-sprint"
                    type="text"
                    className="add-member-input"
                    placeholder="e.g. sprint_1"
                    value={sprintId}
                    onChange={(e) => setSprintId(e.target.value)}
                    disabled={!windowOpen || loadingSubmit}
                  />
                </div>

                <div className="deliverable-form-row">
                  <label htmlFor="deliverable-file">File (PDF, DOCX, Markdown, ZIP)</label>
                  <input
                    id="deliverable-file"
                    type="file"
                    accept=".pdf,.docx,.md,.zip"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    disabled={!windowOpen || loadingSubmit}
                  />
                </div>

                <div className="deliverable-form-row">
                  <label htmlFor="deliverable-description">Description (optional)</label>
                  <input
                    id="deliverable-description"
                    type="text"
                    className="add-member-input"
                    placeholder="Brief description of this submission"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={!windowOpen || loadingSubmit}
                  />
                </div>

                <button
                  type="submit"
                  className="add-member-btn"
                  disabled={!windowOpen || loadingSubmit || !canSubmit}
                >
                  {loadingSubmit ? 'Submitting…' : 'Submit Deliverable'}
                </button>

                {errorMsg && <p className="add-member-error">{errorMsg}</p>}
                {successMsg && <p className="add-member-success">{successMsg}</p>}
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default DeliverableSubmissionForm;
