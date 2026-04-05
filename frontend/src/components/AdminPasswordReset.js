import React, { useState, useEffect, useCallback } from 'react';
import { adminInitiatePasswordReset, getAdminUsersList } from '../api/authService';
import './AdminPasswordReset.css';

/**
 * Admin Panel for Password Reset Management
 *
 * Features:
 * - Direct email/userId input (no broken dropdown)
 * - Generate one-time password reset links
 * - Display reset link with copy-to-clipboard functionality
 * - Countdown timer showing minutes remaining (15 min expiry)
 * - Status indicator for existing reset links
 * - Ability to revoke and generate new links
 * - Button disabled when unexpired link exists
 * - Audit logging on backend
 */
const AdminPasswordReset = () => {
    const [targetUser, setTargetUser] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loadingUsers, setLoadingUsers] = useState(false);

    const [resetLinkInfo, setResetLinkInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [copiedToClipboard, setCopiedToClipboard] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(null);
    const [resetToken, setResetToken] = useState(null);

    /**
     * Countdown timer — ticks every second while a link is active
     */
    useEffect(() => {
        if (!resetLinkInfo?.generatedAt) return;

        const expiryTime = new Date(resetLinkInfo.generatedAt).getTime() + 15 * 60 * 1000;

        const updateCountdown = () => {
            const now = Date.now();
            const remaining = Math.max(0, expiryTime - now);

            if (remaining > 0) {
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                setTimeRemaining({ minutes, seconds });
            } else {
                setTimeRemaining(null);
                setResetLinkInfo(null);
                setResetToken(null);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);
        return () => clearInterval(interval);
    }, [resetLinkInfo?.generatedAt]);

    /**
     * Search for users from backend
     */
    const handleSearchInput = useCallback(async (value) => {
        setTargetUser(value);
        setShowDropdown(false);

        if (value.length < 1) {
            setSearchResults([]);
            return;
        }

        setLoadingUsers(true);
        try {
            const result = await getAdminUsersList(value, 20);
            setSearchResults(result.users || []);
            setShowDropdown(result.users && result.users.length > 0);
        } catch (err) {
            console.error('Failed to fetch users:', err);
            setSearchResults([]);
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    /**
     * Select a user from the dropdown
     */
    const handleSelectUser = (user) => {
        setTargetUser(user.email);
        setSearchResults([]);
        setShowDropdown(false);
    };

    /**
     * Generate password reset link for target user
     */
    const handleGenerateResetLink = async () => {
        if (!targetUser.trim()) {
            setError('Please enter a user email or user ID');
            return;
        }

        setError('');
        setSuccessMessage('');
        setLoading(true);

        try {
            const response = await adminInitiatePasswordReset(targetUser.trim());

            setResetLinkInfo({
                userId: response.userId,
                email: response.email,
                message: response.message,
                generatedAt: new Date(),
            });

            setResetToken(response.resetToken);
            setSuccessMessage(`Reset link generated for ${response.email}`);
            setTargetUser('');
        } catch (err) {
            setError(
                err.response?.data?.message ||
                err.message ||
                'Failed to generate reset link'
            );
        } finally {
            setLoading(false);
        }
    };

    /**
     * Copy reset link to clipboard
     */
    const handleCopyToClipboard = async () => {
        if (!resetToken) return;
        const resetLink = `${window.location.origin}/auth/reset-password?token=${resetToken}`;
        try {
            await navigator.clipboard.writeText(resetLink);
            setCopiedToClipboard(true);
            setTimeout(() => setCopiedToClipboard(false), 3000);
        } catch (err) {
            setError('Failed to copy link to clipboard');
        }
    };

    /**
     * Revoke current link and generate a new one
     */
    const handleRevokeAndNewLink = async () => {
        setError('');
        setSuccessMessage('');
        setLoading(true);

        try {
            const emailToUse = resetLinkInfo?.email;
            const response = await adminInitiatePasswordReset(emailToUse);

            setResetLinkInfo({
                userId: response.userId,
                email: response.email,
                message: response.message,
                generatedAt: new Date(),
            });

            setResetToken(response.resetToken);
            setSuccessMessage('New reset link generated. Previous link is now invalid.');
            setCopiedToClipboard(false);
        } catch (err) {
            setError(
                err.response?.data?.message ||
                err.message ||
                'Failed to generate new reset link'
            );
        } finally {
            setLoading(false);
        }
    };

    /**
     * Clear everything
     */
    const handleClear = () => {
        setTargetUser('');
        setResetLinkInfo(null);
        setResetToken(null);
        setError('');
        setSuccessMessage('');
        setCopiedToClipboard(false);
        setTimeRemaining(null);
    };

    const hasActiveLink = !!timeRemaining;
    const resetLink = resetToken
        ? `${window.location.origin}/auth/reset-password?token=${resetToken}`
        : '';

    return (
        <div className="admin-password-reset-container">
            <div className="admin-password-reset-panel">
                <h1 className="panel-title">Admin: Password Reset Management</h1>
                <p className="panel-description">
                    Generate one-time password reset links for users. Links expire in 15 minutes.
                </p>

                {error && <div className="message error-message">{error}</div>}
                {successMessage && <div className="message success-message">{successMessage}</div>}

                {/* Input Section */}
                <div className="section user-search-section">
                    <h2>Target User</h2>
                    <p className="section-hint">
                        Enter the user's email address or user ID to generate a reset link.
                    </p>
                    <div className="search-container">
                        <div className="search-input-wrapper">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="e.g. alice@university.edu or user-uuid"
                                value={targetUser}
                                onChange={(e) => handleSearchInput(e.target.value)}
                                onFocus={() => targetUser && searchResults.length > 0 && setShowDropdown(true)}
                                onKeyDown={(e) => e.key === 'Enter' && !hasActiveLink && handleGenerateResetLink()}
                                disabled={loading}
                                autoComplete="off"
                            />
                            {showDropdown && searchResults.length > 0 && (
                                <div className="search-dropdown">
                                    {searchResults.map((user) => (
                                        <div
                                            key={user.userId}
                                            className="dropdown-item"
                                            onClick={() => handleSelectUser(user)}
                                        >
                                            <span className="user-email">{user.email}</span>
                                            <span className="user-meta">
                                                {user.role && <span className="user-role">{user.role}</span>}
                                                {!user.emailVerified && <span className="user-status">unverified</span>}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {loadingUsers && (
                                <div className="search-loading">
                                    <span>Searching...</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="section action-section">
                    <button
                        className="btn btn-primary"
                        onClick={handleGenerateResetLink}
                        // Disabled if loading, empty input, or an unexpired link already exists
                        disabled={loading || !targetUser.trim() || hasActiveLink}
                        title={hasActiveLink ? 'An unexpired link already exists. Revoke it first or wait for it to expire.' : ''}
                    >
                        {loading ? 'Generating...' : 'Generate Reset Link'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={handleClear}
                        disabled={loading}
                    >
                        Clear
                    </button>
                </div>

                {/* Hint when button is disabled due to active link */}
                {hasActiveLink && !resetLinkInfo === false && (
                    <p className="hint-text">
                        ⚠️ An active link exists for this user. Use "Revoke &amp; Generate New" below to replace it.
                    </p>
                )}

                {/* Reset Link Display */}
                {resetLinkInfo && resetToken && (
          <div className="section reset-link-section">
            <div className="link-header">
              <h3>Reset Link Generated</h3>
              {timeRemaining ? (
                <div className="expiry-status active">
                  <span className="expiry-dot" />
                  <span className="expiry-label">Expires in:</span>
                  <span className="expiry-countdown">
                    {timeRemaining.minutes}m {timeRemaining.seconds}s
                  </span>
                </div>
              ) : (
                <div className="expiry-status expired">
                  <span className="expiry-label">Link expired</span>
                </div>
              )}
            </div>

            <div className="user-info">
              <p><strong>Email:</strong> {resetLinkInfo.email}</p>
              <p><strong>User ID:</strong> {resetLinkInfo.userId}</p>
            </div>

            <div className="link-display">
              <label>Reset Link (share with user):</label>
              <div className="link-display-wrapper">
                <input
                  type="text"
                  className="link-input"
                  readOnly
                  value={resetLink}
                />
                <button
                  className={`btn btn-copy ${copiedToClipboard ? 'copied' : ''}`}
                  onClick={handleCopyToClipboard}
                  disabled={!timeRemaining}
                  style={{width: 'auto'}}
                >
                  {copiedToClipboard ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              {copiedToClipboard && (
                <p className="copy-feedback">✓ Link copied to clipboard!</p>
              )}
            </div>

            <div className="link-actions">
              <button
                className="btn btn-revoke"
                onClick={handleRevokeAndNewLink}
                disabled={loading}
              >
                {loading ? 'Generating...' : 'Revoke & Generate New'}
              </button>
            </div>
          </div>
        )}
        </div>
    </div >
  );
};

export default AdminPasswordReset;