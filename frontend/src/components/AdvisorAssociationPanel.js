import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  submitAdvisorRequest,
  releaseAdvisor,
  getAdvisorAssociationWindow,
  searchProfessors,
} from '../api/advisorService';
import { getGroup } from '../api/groupService';
import useAuthStore from '../store/authStore';

const AdvisorAssociationPanel = () => {
  const { group_id: groupId } = useParams();
  const user = useAuthStore((state) => state.user);

  const [group, setGroup] = useState(null);
  const [professors, setProfessors] = useState([]);
  const [selectedProfessor, setSelectedProfessor] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isReleasingAdvisor, setIsReleasingAdvisor] = useState(false);
  const [pageError, setPageError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Map HTTP error status codes to user-friendly messages
  const getErrorMessage = (err) => {
    const httpStatus = err.response?.status;
    if (httpStatus === 422) {
      return 'The advisor association window is currently closed.';
    }
    if (httpStatus === 409) {
      return 'This group already has an active advisor request.';
    }
    return err.response?.data?.message || 'An error occurred. Please try again.';
  };

  // Render semantic badge for advisor status
  const renderStatusBadge = (statusValue) => {
    if (!statusValue) return 'No advisor request available';

    let bgColor = '#e5e7eb';
    let textColor = '#374151';
    let displayText = statusValue;

    if (statusValue?.toLowerCase() === 'pending') {
      bgColor = '#fef3c7';
      textColor = '#b45309';
      displayText = 'Pending';
    } else if (statusValue?.toLowerCase() === 'approved') {
      bgColor = '#dcfce7';
      textColor = '#166534';
      displayText = 'Approved';
    } else if (statusValue?.toLowerCase() === 'rejected') {
      bgColor = '#fee2e2';
      textColor = '#b91c1c';
      displayText = 'Rejected';
    } else if (statusValue?.toLowerCase() === 'assigned') {
      bgColor = '#dbeafe';
      textColor = '#1e40af';
      displayText = 'Assigned';
    }

    return (
      <span
        style={{
          display: 'inline-block',
          backgroundColor: bgColor,
          color: textColor,
          padding: '6px 12px',
          borderRadius: '6px',
          fontWeight: 500,
          fontSize: '14px',
        }}
      >
        {displayText}
      </span>
    );
  };

  const fetchGroup = async () => {
    try {
      setPageError('');
      const data = await getGroup(groupId);
      setGroup(data);
      setStatus(data?.advisorStatus || data?.advisor_status || null);
    } catch (err) {
      console.error(err);
      setPageError(err.response?.data?.message || 'Failed to load advisor information.');
    }
  };

  const fetchProfessors = async () => {
    try {
      const data = await searchProfessors();
      setProfessors(data?.professors || data?.items || data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const checkSchedule = async () => {
    try {
      const data = await getAdvisorAssociationWindow();
      setScheduleOpen(Boolean(data?.open));
    } catch (err) {
      console.error(err);
      setScheduleOpen(false);
    }
  };

  useEffect(() => {
    if (!groupId) return;
    fetchGroup();
    fetchProfessors();
    checkSchedule();
  }, [groupId]);

  const handleSubmit = async () => {
    setPageError('');
    setSuccessMessage('');

    if (!selectedProfessor) {
      setPageError('Please select a professor.');
      return;
    }

    try {
      setIsSubmittingRequest(true);
      await submitAdvisorRequest({
        groupId,
        professorId: selectedProfessor,
        message,
      });
      setSuccessMessage('Advisor request submitted successfully.');
      setMessage('');
      await fetchGroup();
    } catch (err) {
      console.error(err);
      setPageError(getErrorMessage(err));
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleRelease = async () => {
    setPageError('');
    setSuccessMessage('');

    const confirmed = window.confirm('Are you sure you want to release the current advisor?');
    if (!confirmed) return;

    try {
      setIsReleasingAdvisor(true);
      await releaseAdvisor(groupId);
      setSuccessMessage('Advisor released successfully.');
      await fetchGroup();
    } catch (err) {
      console.error(err);
      setPageError(getErrorMessage(err));
    } finally {
      setIsReleasingAdvisor(false);
    }
  };

  const isLeader = group?.leaderId === user?.userId;
  const assignedAdvisorId =
    group?.advisorId || group?.advisor_id || group?.assignedProfessorId || group?.professorId;

  return (
    <div className="page" style={{ padding: '24px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Advisor Association</h1>

        {!scheduleOpen && isLeader && (
          <div
            style={{
              backgroundColor: '#fff3cd',
              color: '#856404',
              border: '1px solid #ffe69c',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            ⏰ Advisor association window is currently closed. The form is disabled until the schedule reopens.
          </div>
        )}

        {pageError && (
          <div
            style={{
              backgroundColor: '#f8d7da',
              color: '#842029',
              border: '1px solid #f5c2c7',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            ❌ {pageError}
          </div>
        )}

        {successMessage && (
          <div
            style={{
              backgroundColor: '#d1e7dd',
              color: '#0f5132',
              border: '1px solid #badbcc',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            ✓ {successMessage}
          </div>
        )}

        <div
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            padding: '20px',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: '18px' }}>Request Status</h2>
          <p style={{ marginBottom: 0 }}>
            <strong>Status:</strong> {renderStatusBadge(status)}
          </p>
        </div>

        {assignedAdvisorId && (
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              padding: '20px',
              marginBottom: '20px',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '18px' }}>Assigned Advisor</h2>
            <p>
              <strong>Professor ID:</strong> {assignedAdvisorId}
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong>Assignment Status:</strong>{' '}
              <span style={{ marginLeft: '8px', verticalAlign: 'middle' }}>
                {renderStatusBadge(status || 'assigned')}
              </span>
            </p>

            {isLeader && (
              <button
                type="button"
                onClick={handleRelease}
                disabled={isReleasingAdvisor}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: isReleasingAdvisor ? '#9ca3af' : '#dc2626',
                  color: 'white',
                  cursor: isReleasingAdvisor ? 'not-allowed' : 'pointer',
                }}
              >
                {isReleasingAdvisor ? 'Processing...' : 'Release Advisor'}
              </button>
            )}
          </div>
        )}

        {isLeader ? (
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              padding: '20px',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '18px' }}>Submit Advisee Request</h2>

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="professorSelect" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                Select Professor
              </label>
              <select
                id="professorSelect"
                value={selectedProfessor}
                onChange={(e) => setSelectedProfessor(e.target.value)}
                disabled={!scheduleOpen || isSubmittingRequest}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                }}
              >
                <option value="">Select a professor</option>
                {professors.map((professor) => {
                  const professorId = professor.professorId || professor.userId || professor.id;
                  const professorName = professor.name || professor.fullName || professorId;

                  return (
                    <option key={professorId} value={professorId}>
                      {professorName}
                    </option>
                  );
                })}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="advisorMessage" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                Message (optional)
              </label>
              <textarea
                id="advisorMessage"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={!scheduleOpen || isSubmittingRequest}
                rows={4}
                placeholder="Write an optional message to the professor"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  resize: 'vertical',
                }}
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!scheduleOpen || isSubmittingRequest}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: !scheduleOpen || isSubmittingRequest ? '#9ca3af' : '#2563eb',
                color: 'white',
                cursor: !scheduleOpen || isSubmittingRequest ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmittingRequest ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        ) : (
          <div
            style={{
              background: '#f0f9ff',
              border: '1px solid #bfdbfe',
              borderRadius: '10px',
              padding: '20px',
            }}
          >
            <div
              style={{
                backgroundColor: '#dbeafe',
                color: '#1e40af',
                border: '1px solid #93c5fd',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '14px',
              }}
            >
              📋 You are viewing this panel in read-only mode as a group member. Only the team leader can submit or release advisor requests.
            </div>
            <h2 style={{ marginTop: 0, fontSize: '18px' }}>Advisor Information</h2>
            <p style={{ marginBottom: 0, color: '#666' }}>
              You can view the current advisor information and request status for your group.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvisorAssociationPanel;