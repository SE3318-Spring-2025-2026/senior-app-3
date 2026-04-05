import React, { useState } from 'react';
import { adminCreateProfessor } from '../api/authService';
import './AdminProfessorCreation.css';

/**
 * Admin Panel for Professor Account Creation
 *
 * Features:
 * - Create professor account with email, first name, last name
 * - Generate temporary password (12 characters)
 * - Set force_password_change flag
 * - Send credentials via email
 * - Audit logging on backend
 */
const AdminProfessorCreation = () => {
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [createdProfessor, setCreatedProfessor] = useState(null);

  /**
   * Handle form input changes
   */
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value.trim(),
    }));
  };

  /**
   * Validate email format
   */
  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  /**
   * Create professor account
   */
  const handleCreateProfessor = async (e) => {
    e.preventDefault();

    // Validation
    if (!formData.email) {
      setError('Email is required');
      return;
    }

    if (!isValidEmail(formData.email)) {
      setError('Please enter a valid email address');
      return;
    }

    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      const response = await adminCreateProfessor(
        formData.email,
        formData.firstName,
        formData.lastName
      );

      setCreatedProfessor({
        userId: response.userId,
        email: response.email,
        firstName: response.firstName,
        lastName: response.lastName,
      });

      setSuccessMessage(`Professor account created successfully for ${response.email}`);

      // Reset form
      setFormData({
        email: '',
        firstName: '',
        lastName: '',
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.message ||
        'Failed to create professor account'
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * Create another professor
   */
  const handleCreateAnother = () => {
    setCreatedProfessor(null);
    setSuccessMessage('');
  };

  return (
    <div className="admin-professor-creation-container">
      <div className="admin-professor-creation-panel">
        <h1 className="panel-title">Admin: Professor Account Creation</h1>
        <p className="panel-description">
          Create new professor accounts. Temporary credentials will be sent via email.
        </p>

        {/* Error Message */}
        {error && <div className="message error-message">{error}</div>}

        {/* Success Message */}
        {successMessage && <div className="message success-message">{successMessage}</div>}

        {!createdProfessor ? (
          <>
            {/* Creation Form */}
            <form onSubmit={handleCreateProfessor} className="professor-form">
              {/* Email Field */}
              <div className="form-group">
                <label htmlFor="email">Email Address *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  placeholder="professor@university.edu"
                  value={formData.email}
                  onChange={handleInputChange}
                  disabled={loading}
                  required
                />
                <p className="field-hint">University email address for the professor</p>
              </div>

              {/* First Name Field */}
              <div className="form-group">
                <label htmlFor="firstName">First Name</label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  placeholder="Dr. Jane"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  disabled={loading}
                />
              </div>

              {/* Last Name Field */}
              <div className="form-group">
                <label htmlFor="lastName">Last Name</label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  placeholder="Smith"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  disabled={loading}
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !formData.email}
              >
                {loading ? 'Creating Account...' : 'Create Professor Account'}
              </button>
            </form>
          </>
        ) : (
          <>
            {/* Success Summary */}
            <div className="success-summary">
              <div className="success-icon">✓</div>
              <h2>Professor Account Created</h2>

              <div className="summary-details">
                <p>
                  <strong>Email:</strong> {createdProfessor.email}
                </p>
                {createdProfessor.firstName && (
                  <p>
                    <strong>First Name:</strong> {createdProfessor.firstName}
                  </p>
                )}
                {createdProfessor.lastName && (
                  <p>
                    <strong>Last Name:</strong> {createdProfessor.lastName}
                  </p>
                )}
                <p>
                  <strong>User ID:</strong> <code>{createdProfessor.userId}</code>
                </p>
              </div>

              <div className="next-steps">
                <h3>Next Steps:</h3>
                <ol>
                  <li>
                    Credentials have been sent to <strong>{createdProfessor.email}</strong>
                  </li>
                  <li>Professor should check their email for temporary password</li>
                  <li>
                    They will be required to change their password on first login
                  </li>
                </ol>
              </div>

              {/* Action Buttons */}
              <div className="action-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleCreateAnother}
                >
                  Create Another Professor
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminProfessorCreation;
