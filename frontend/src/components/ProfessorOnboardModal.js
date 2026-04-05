import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { professorOnboard } from '../api/authService';
import { validatePasswordStrength } from '../utils/passwordValidator';

const PasswordStrengthBar = ({ password }) => {
  if (!password) return null;
  const { errors } = validatePasswordStrength(password);
  const passed = 5 - errors.length;
  const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60'];
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= passed ? colors[passed - 1] : '#e0e0e0',
              transition: 'background-color 0.2s',
            }}
          />
        ))}
      </div>
      {passed < 5 && (
        <small style={{ color: colors[passed - 1] || '#999' }}>
          {passed === 0 ? 'Very Weak' : labels[passed - 1]}
          {errors.length > 0 && `: ${errors[0]}`}
        </small>
      )}
      {passed === 5 && <small style={{ color: '#27ae60' }}>Strong password</small>}
    </div>
  );
};

/**
 * Full-screen modal shown to professors on first login.
 * Blocks all navigation until the password is changed.
 */
const ProfessorOnboardModal = () => {
  const navigate = useNavigate();
  const { user, setRequiresPasswordChange, setUser } = useAuthStore();

  const [formData, setFormData] = useState({ newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors = {};
    const { isValid, errors: strengthErrors } = validatePasswordStrength(formData.newPassword);
    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (!isValid) {
      newErrors.newPassword = strengthErrors[0];
    }
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await professorOnboard(formData.newPassword);
      setRequiresPasswordChange(false);
      setUser({ ...user, accountStatus: 'active', requiresPasswordChange: false });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'WEAK_PASSWORD') {
        setErrors({ newPassword: err.response.data.details?.[0] || 'Password too weak' });
      } else {
        setErrors({ submit: err.response?.data?.message || 'Password change failed. Please try again.' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.badge}>First Login</span>
          <h2 style={styles.title}>Set Your Password</h2>
          <p style={styles.subtitle}>
            Welcome, {user?.email}! Before you continue, you must set a new password for your
            account. You cannot navigate away until this is complete.
          </p>
        </div>

        {errors.submit && (
          <div style={styles.alertError}>{errors.submit}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label} htmlFor="newPassword">
              New Password
            </label>
            <input
              type="password"
              id="newPassword"
              name="newPassword"
              value={formData.newPassword}
              onChange={handleChange}
              placeholder="Min 8 chars, upper, lower, digit, symbol"
              style={{
                ...styles.input,
                ...(errors.newPassword ? styles.inputError : {}),
              }}
              disabled={loading}
            />
            <PasswordStrengthBar password={formData.newPassword} />
            {errors.newPassword && (
              <span style={styles.errorMessage}>{errors.newPassword}</span>
            )}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label} htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Re-enter your new password"
              style={{
                ...styles.input,
                ...(errors.confirmPassword ? styles.inputError : {}),
              }}
              disabled={loading}
            />
            {errors.confirmPassword && (
              <span style={styles.errorMessage}>{errors.confirmPassword}</span>
            )}
          </div>

          <div style={styles.requirements}>
            <p style={styles.requirementsTitle}>Password requirements:</p>
            <ul style={styles.requirementsList}>
              <li>At least 8 characters</li>
              <li>One uppercase letter (A–Z)</li>
              <li>One lowercase letter (a–z)</li>
              <li>One digit (0–9)</li>
              <li>One special character (!@#$%^&amp;*)</li>
            </ul>
          </div>

          <button type="submit" style={styles.submitButton} disabled={loading}>
            {loading ? 'Saving...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  modal: {
    background: 'white',
    borderRadius: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    padding: 40,
    width: '100%',
    maxWidth: 480,
  },
  header: {
    marginBottom: 24,
    textAlign: 'center',
  },
  badge: {
    display: 'inline-block',
    background: '#fff3cd',
    color: '#856404',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.8rem',
    fontWeight: 600,
    marginBottom: 12,
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '1.8rem',
    color: '#333',
    fontWeight: 700,
  },
  subtitle: {
    color: '#666',
    fontSize: '0.95rem',
    margin: 0,
  },
  alertError: {
    background: '#fee',
    borderLeft: '4px solid #e74c3c',
    color: '#e74c3c',
    padding: 15,
    borderRadius: 6,
    marginBottom: 20,
    fontSize: '0.95rem',
  },
  formGroup: {
    marginBottom: 20,
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    marginBottom: 8,
    fontWeight: 600,
    color: '#333',
    fontSize: '0.95rem',
  },
  input: {
    padding: '12px 15px',
    border: '2px solid #e0e0e0',
    borderRadius: 6,
    fontSize: '1rem',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.3s ease',
  },
  inputError: {
    borderColor: '#e74c3c',
  },
  errorMessage: {
    color: '#e74c3c',
    fontSize: '0.85rem',
    marginTop: 5,
  },
  requirements: {
    background: '#fff3cd',
    borderLeft: '4px solid #ffc107',
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
    fontSize: '0.9rem',
  },
  requirementsTitle: {
    margin: '0 0 8px 0',
    fontWeight: 600,
    color: '#856404',
  },
  requirementsList: {
    margin: 0,
    paddingLeft: 20,
    color: '#856404',
  },
  submitButton: {
    width: '100%',
    padding: 12,
    border: 'none',
    borderRadius: 6,
    fontSize: '1rem',
    fontWeight: 600,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
  },
};

export default ProfessorOnboardModal;
