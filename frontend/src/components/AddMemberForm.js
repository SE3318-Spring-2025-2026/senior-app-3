import React, { useState } from 'react';
import { addGroupMembers } from '../api/groupService';

/**
 * AddMemberForm — Process 2.3
 * Visible only to the Team Leader. Submits student email/ID to
 * POST /groups/:groupId/members (flows f05, f06, f19, f32).
 */
const AddMemberForm = ({ groupId, onMemberAdded }) => {
  const [studentInput, setStudentInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = studentInput.trim();
    if (!trimmed) return;

    setLoading(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      const result = await addGroupMembers(groupId, [trimmed]);

      if (result.added && result.added.length > 0) {
        setSuccessMsg(`Invitation sent to ${trimmed}.`);
        setStudentInput('');
        if (onMemberAdded) onMemberAdded(result);
      } else if (result.errors && result.errors.length > 0) {
        const err = result.errors[0];
        if (err.code === 'STUDENT_NOT_FOUND') {
          setErrorMsg('No student found with that email or ID.');
        } else if (err.code === 'ALREADY_INVITED') {
          setErrorMsg('This student has already been invited.');
        } else if (err.code === 'STUDENT_ALREADY_IN_GROUP') {
          setErrorMsg('This student already belongs to another group.');
        } else {
          setErrorMsg(err.message || 'Could not add student.');
        }
      }
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'FORBIDDEN') {
        setErrorMsg('Only the group leader can add members.');
      } else {
        setErrorMsg(err.response?.data?.message || 'An unexpected error occurred.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-member-section">
      <div className="members-header">
        <h3>Invite a Member</h3>
      </div>
      <form onSubmit={handleSubmit} className="add-member-form">
        <div className="add-member-input-group">
          <input
            type="text"
            className={`add-member-input${errorMsg ? ' input-error' : ''}`}
            value={studentInput}
            onChange={(e) => {
              setStudentInput(e.target.value);
              setSuccessMsg('');
              setErrorMsg('');
            }}
            placeholder="Student email (e.g. charlie@university.edu)"
            disabled={loading}
          />
          <button
            type="submit"
            className="add-member-btn"
            disabled={loading || !studentInput.trim()}
          >
            {loading ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
        {errorMsg && <p className="add-member-error">{errorMsg}</p>}
        {successMsg && <p className="add-member-success">{successMsg}</p>}
      </form>
    </div>
  );
};

export default AddMemberForm;
