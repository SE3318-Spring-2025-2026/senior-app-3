import React, { useEffect, useMemo, useState } from 'react';
import { getScheduleWindow } from '../api/groupService';
import { getGroupDeliverables, submitDeliverable } from '../api/deliverableService';

const DELIVERABLE_TYPES = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'statement_of_work', label: 'Statement of Work' },
  { value: 'demonstration', label: 'Demonstration' },
];

const DeliverableSubmissionForm = ({
  groupId,
  isLeader,
  userId,
  members,
  committeeStatus,
  onSuccess,
}) => {
  const [selectedType, setSelectedType] = useState('proposal');
  const [storageMode, setStorageMode] = useState('file');
  const [file, setFile] = useState(null);
  const [link, setLink] = useState('');
  const [windowOpen, setWindowOpen] = useState(false);
  const [windowInfo, setWindowInfo] = useState(null);
  const [loadingWindow, setLoadingWindow] = useState(true);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submittedDeliverables, setSubmittedDeliverables] = useState({});

  const isGroupMember = useMemo(() => {
    if (!members || !Array.isArray(members)) return false;
    return members.some((member) => member.userId === userId || member.user_id === userId);
  }, [members, userId]);

  const isPublished = committeeStatus === 'published' || committeeStatus === 'Published';
  const canSubmit = isLeader && isPublished;

  useEffect(() => {
    const fetchWindowAndSubmission = async () => {
      setLoadingWindow(true);
      try {
        const schedule = await getScheduleWindow('deliverable_submission');
        setWindowOpen(Boolean(schedule.open));
        setWindowInfo(schedule.window || null);
      } catch (error) {
        setWindowOpen(false);
        setWindowInfo(null);
      }

      try {
        const data = await getGroupDeliverables(groupId);
        const deliverables = data.deliverables || data.items || data.data || [];
        const byType = {};
        if (Array.isArray(deliverables)) {
          deliverables.forEach((d) => {
            byType[d.type] = d;
          });
        }
        setSubmittedDeliverables(byType);
      } catch {
        setSubmittedDeliverables({});
      } finally {
        setLoadingWindow(false);
      }
    };

    fetchWindowAndSubmission();
  }, [groupId]);

  const resetForm = () => {
    setFile(null);
    setLink('');
    setSelectedType('proposal');
    setStorageMode('file');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedType) {
      setErrorMsg('Please select a deliverable type.');
      return;
    }

    if (storageMode === 'file' && !file) {
      setErrorMsg('Please select a deliverable file.');
      return;
    }

    if (storageMode === 'link') {
      const trimmedLink = link.trim();
      if (!trimmedLink) {
        setErrorMsg('Please enter a valid URL.');
        return;
      }
      try {
        new URL(trimmedLink);
      } catch {
        setErrorMsg('Please enter a valid URL.');
        return;
      }
    }

    setLoadingSubmit(true);

    try {
      const formData = new FormData();
      formData.append('type', selectedType);
      formData.append('storageRef', storageMode === 'link' ? link.trim() : '');
      if (storageMode === 'file') {
        formData.append('file', file);
      }
      const result = await submitDeliverable(groupId, formData);
      setSubmittedDeliverables((prev) => ({
        ...prev,
        [result.type]: result,
      }));
      resetForm();
      setSuccessMsg('Deliverable submitted successfully.');
      if (onSuccess) onSuccess();
    } catch (error) {
      const status = error.response?.status;
      const code = error.response?.data?.code;

      if (status === 403) {
        setErrorMsg('Only the team leader can submit deliverables.');
      } else if (status === 422) {
        setErrorMsg('The submission schedule window is closed.');
      } else if (status === 400 || code === 'INVALID_DELIVERABLE') {
        setErrorMsg(error.response?.data?.message || 'Invalid deliverable submission.');
      } else {
        setErrorMsg(error.response?.data?.message || 'Could not submit your deliverable.');
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
                <span className="info-label">Deliverable ID</span>
                <span className="info-value">{data.deliverableId || data.id || 'N/A'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Submitted At</span>
                <span className="info-value">
                  {data.submittedAt
                    ? new Date(data.submittedAt).toLocaleString()
                    : 'N/A'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Storage Reference</span>
                <span className="info-value">{data.storageRef || data.url || 'N/A'}</span>
              </div>
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
            Once the committee is published, the team leader can submit a proposal, statement of work,
            or demonstration.
          </p>
        </div>
      )}

      {isPublished && loadingWindow && (
        <div className="deliverable-status-message">Checking submission window...</div>
      )}

      {isPublished && !loadingWindow && (
        <>
          {renderExistingSubmissions()}

          {!isGroupMember && (
            <div className="deliverable-locked-card">
              <p>
                You can view deliverable status in read-only mode. Only the team leader can submit deliverables.
              </p>
            </div>
          )}

          {isLeader && (
            <>
              {!windowOpen && (
                <div className="deliverable-closed-banner">
                  <strong>Submission window closed:</strong> The deliverable submission period is currently unavailable.
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
                    {DELIVERABLE_TYPES.map((option) => {
                      const isSubmitted = submittedDeliverables[option.value];
                      return (
                        <option key={option.value} value={option.value}>
                          {option.label}{isSubmitted ? ' (Re-submit)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="deliverable-form-row deliverable-mode-toggle">
                  <button
                    type="button"
                    className={`toggle-button${storageMode === 'file' ? ' active' : ''}`}
                    onClick={() => setStorageMode('file')}
                    disabled={loadingSubmit}
                  >
                    Upload File
                  </button>
                  <button
                    type="button"
                    className={`toggle-button${storageMode === 'link' ? ' active' : ''}`}
                    onClick={() => setStorageMode('link')}
                    disabled={loadingSubmit}
                  >
                    Submit Link
                  </button>
                </div>

                {storageMode === 'file' ? (
                  <div className="deliverable-form-row">
                    <label htmlFor="deliverable-file">File (PDF, Word, Markdown, ZIP)</label>
                    <input
                      id="deliverable-file"
                      type="file"
                      accept=".pdf,.docx,.md,.zip"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      disabled={!windowOpen || loadingSubmit}
                    />
                  </div>
                ) : (
                  <div className="deliverable-form-row">
                    <label htmlFor="deliverable-link">Submission URL</label>
                    <input
                      id="deliverable-link"
                      type="url"
                      className="add-member-input"
                      placeholder="https://example.com/your-deliverable"
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      disabled={!windowOpen || loadingSubmit}
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="add-member-btn"
                  disabled={!windowOpen || loadingSubmit}
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
