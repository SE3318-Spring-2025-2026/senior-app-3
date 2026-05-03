import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { updateProfile } from '../api/profileService';
import './ProfilePage.css';

const ProfilePage = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const setUser = useAuthStore((state) => state.setUser);
  const [isEditing, setIsEditing] = useState(false);
  const [editedUser, setEditedUser] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  useEffect(() => {
    if (user) {
      setEditedUser({ ...user });
    }
  }, [user]);

  const handleLogout = () => {
    clearAuth();
    navigate('/auth/method-selection');
  };

  const handleEditChange = (field, value) => {
    setEditedUser({
      ...editedUser,
      [field]: value,
    });
  };

  const handleSaveChanges = async () => {
    const updates = {};
    if (editedUser.githubUsername !== user.githubUsername) {
      updates.githubUsername = editedUser.githubUsername || '';
    }
    if (Object.keys(updates).length === 0) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await updateProfile(user.userId, updates);
      setUser(updates);
      setSaveMessage({ type: 'success', text: 'Profile updated successfully.' });
      setIsEditing(false);
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.response?.data?.message || 'Failed to save changes.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedUser({ ...user });
    setSaveMessage(null);
  };

  if (!user) {
    return (
      <main className="profile-page">
        <div className="profile-container">
          <div className="profile-error">
            <p>User information not available. Please log in again.</p>
          </div>
        </div>
      </main>
    );
  }

  const getRoleDisplay = (role) => {
    const roleMap = {
      student: 'Student',
      professor: 'Professor',
      advisor: 'Advisor',
      coordinator: 'Coordinator',
      admin: 'Administrator',
      system: 'System',
      committee_member: 'Committee Member',
    };
    return roleMap[role] || role;
  };

  const getStatusDisplay = (status) => {
    const statusMap = {
      pending: 'Pending Verification',
      active: 'Active',
      suspended: 'Suspended',
    };
    return statusMap[status] || status;
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <main className="profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <h1>My Profile</h1>
          <div className="profile-actions">
            <button
              className="btn btn-secondary"
              onClick={() => isEditing ? handleCancelEdit() : setIsEditing(true)}
            >
              {isEditing ? 'Cancel' : 'Edit Profile'}
            </button>
            <button className="btn btn-danger" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        {saveMessage && (
          <div className={`profile-save-message profile-save-message--${saveMessage.type}`}>
            {saveMessage.text}
          </div>
        )}

        <div className="profile-content">
          {/* Primary Information Section */}
          <div className="profile-section">
            <div className="section-header">
              <h2>Account Information</h2>
            </div>
            <div className="section-content">
              <div className="info-grid">
                {/* Email */}
                <div className="info-field">
                  <label className="info-label">Email</label>
                  {isEditing ? (
                    <input
                      type="email"
                      className="info-input"
                      value={editedUser?.email || ''}
                      onChange={(e) => handleEditChange('email', e.target.value)}
                      disabled
                    />
                  ) : (
                    <div className="info-value">{user.email}</div>
                  )}
                </div>

                {/* User ID */}
                <div className="info-field">
                  <label className="info-label">User ID</label>
                  <div className="info-value">{user.userId || 'N/A'}</div>
                </div>

                {/* Role */}
                <div className="info-field">
                  <label className="info-label">Role</label>
                  <div className="info-value role-badge">
                    {getRoleDisplay(user.role)}
                  </div>
                </div>

                {/* Account Status */}
                <div className="info-field">
                  <label className="info-label">Account Status</label>
                  <div className={`info-value status-badge status-${user.accountStatus || 'pending'}`}>
                    {getStatusDisplay(user.accountStatus)}
                  </div>
                </div>

                {/* Student ID */}
                {user.studentId && (
                  <div className="info-field">
                    <label className="info-label">Student ID</label>
                    <div className="info-value">{user.studentId}</div>
                  </div>
                )}

                {/* GitHub Username */}
                <div className="info-field">
                  <label className="info-label">GitHub Username</label>
                  {isEditing ? (
                    <input
                      type="text"
                      className="info-input"
                      value={editedUser?.githubUsername || ''}
                      onChange={(e) => handleEditChange('githubUsername', e.target.value)}
                      placeholder="your-github-username"
                    />
                  ) : user.githubUsername ? (
                    <div className="info-value github-username">
                      <a
                        href={`https://github.com/${user.githubUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        @{user.githubUsername}
                      </a>
                    </div>
                  ) : (
                    <div className="info-value">Not linked</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Email Verification Section */}
          <div className="profile-section">
            <div className="section-header">
              <h2>Verification Status</h2>
            </div>
            <div className="section-content">
              <div className="verification-status">
                <div className="verification-item">
                  <span className="verification-label">Email Verified:</span>
                  <span className={`verification-badge ${user.emailVerified ? 'verified' : 'unverified'}`}>
                    {user.emailVerified ? '✓ Verified' : '✗ Not Verified'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Account Activity Section */}
          <div className="profile-section">
            <div className="section-header">
              <h2>Account Activity</h2>
            </div>
            <div className="section-content">
              <div className="info-grid">
                {/* Created At */}
                <div className="info-field">
                  <label className="info-label">Account Created</label>
                  <div className="info-value">{formatDate(user.createdAt)}</div>
                </div>

                {/* Last Login */}
                <div className="info-field">
                  <label className="info-label">Last Login</label>
                  <div className="info-value">{formatTime(user.lastLogin)}</div>
                </div>

                {/* Updated At */}
                <div className="info-field">
                  <label className="info-label">Last Updated</label>
                  <div className="info-value">{formatTime(user.updatedAt)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Profile Groups Section */}
          {user.groupId && (
            <div className="profile-section">
              <div className="section-header">
                <h2>Group Information</h2>
              </div>
              <div className="section-content">
                <div className="info-field">
                  <label className="info-label">Active Group ID</label>
                  <div className="info-value">{user.groupId}</div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Actions */}
          {isEditing && (
            <div className="profile-section edit-actions">
              <button
                className="btn btn-primary"
                onClick={handleSaveChanges}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

export default ProfilePage;
