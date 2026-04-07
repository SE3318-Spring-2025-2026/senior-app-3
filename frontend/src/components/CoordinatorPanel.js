import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listScheduleWindows,
  createScheduleWindow,
  deactivateScheduleWindow,
} from '../api/groupService';

const OPERATION_TYPES = [
  { value: 'group_creation', label: 'Group Creation' },
  { value: 'member_addition', label: 'Member Addition' },
];

const toLocalDatetimeValue = (date) => {
  if (!date) return '';
  const d = new Date(date);
  // Format as YYYY-MM-DDTHH:MM for datetime-local input
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Coordinator Panel
 * Allows coordinators to configure schedule windows per operation type.
 */
const CoordinatorPanel = () => {
  const navigate = useNavigate();

  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const [form, setForm] = useState({
    operationType: 'group_creation',
    startsAt: '',
    endsAt: '',
    label: '',
  });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadWindows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listScheduleWindows();
      setWindows(data.windows);
    } catch {
      setError('Failed to load schedule windows.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWindows();
  }, [loadWindows]);

  const handleFormChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setFormError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!form.startsAt || !form.endsAt) {
      setFormError('Both open and close times are required.');
      return;
    }
    if (new Date(form.endsAt) <= new Date(form.startsAt)) {
      setFormError('Close time must be after open time.');
      return;
    }

    setSubmitting(true);
    try {
      await createScheduleWindow(
        form.operationType,
        new Date(form.startsAt).toISOString(),
        new Date(form.endsAt).toISOString(),
        form.label
      );
      setSuccessMsg(`Schedule window for "${OPERATION_TYPES.find((t) => t.value === form.operationType)?.label}" created.`);
      setForm((prev) => ({ ...prev, startsAt: '', endsAt: '', label: '' }));
      await loadWindows();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to create schedule window.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (windowId) => {
    setSuccessMsg(null);
    setError(null);
    try {
      await deactivateScheduleWindow(windowId);
      setSuccessMsg('Schedule window deactivated.');
      await loadWindows();
    } catch {
      setError('Failed to deactivate window.');
    }
  };

  const activeWindows = windows.filter((w) => w.isActive);
  const inactiveWindows = windows.filter((w) => !w.isActive);

  return (
    <div className="page" style={{ padding: '24px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#e1e4e8',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            marginBottom: '24px',
          }}
        >
          ← Back
        </button>

        <h1 style={{ marginTop: 0 }}>Coordinator Panel</h1>

        {/* ── Schedule Window Configuration ─────────────────────────── */}
        <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
          <h2 style={{ marginTop: 0, fontSize: '18px' }}>Configure Schedule Window</h2>
          <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
            Set the open and close times for group formation operations. Creating a new window for an
            operation type will deactivate any overlapping existing windows of that type.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label htmlFor="sw-operationType" style={labelStyle}>Operation Type</label>
                <select
                  id="sw-operationType"
                  name="operationType"
                  value={form.operationType}
                  onChange={handleFormChange}
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
                  value={form.label}
                  onChange={handleFormChange}
                  placeholder="e.g. Spring 2026 – Group Creation"
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="sw-startsAt" style={labelStyle}>Open At</label>
                <input
                  id="sw-startsAt"
                  name="startsAt"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={handleFormChange}
                  style={inputStyle}
                  required
                />
              </div>

              <div>
                <label htmlFor="sw-endsAt" style={labelStyle}>Close At</label>
                <input
                  id="sw-endsAt"
                  name="endsAt"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={handleFormChange}
                  style={inputStyle}
                  required
                />
              </div>
            </div>

            {formError && <p style={{ color: '#d73a49', fontSize: '14px', marginBottom: '12px' }}>{formError}</p>}
            {successMsg && <p style={{ color: '#22863a', fontSize: '14px', marginBottom: '12px' }}>{successMsg}</p>}

            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '10px 20px',
                backgroundColor: submitting ? '#ccc' : '#0366d6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '600',
              }}
            >
              {submitting ? 'Saving…' : 'Create Window'}
            </button>
          </form>
        </section>

        {/* ── Active Windows ─────────────────────────────────────────── */}
        <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
          <h2 style={{ marginTop: 0, fontSize: '18px' }}>Active Windows</h2>

          {loading && <p style={{ color: '#666' }}>Loading…</p>}
          {error && <p style={{ color: '#d73a49' }}>{error}</p>}

          {!loading && activeWindows.length === 0 && (
            <p style={{ color: '#666', fontSize: '14px' }}>No active schedule windows. All operations are currently blocked.</p>
          )}

          {activeWindows.map((w) => (
            <WindowRow key={w.windowId} window={w} onDeactivate={handleDeactivate} />
          ))}
        </section>

        {/* ── Inactive Windows ───────────────────────────────────────── */}
        {inactiveWindows.length > 0 && (
          <section style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', color: '#666' }}>Past / Deactivated Windows</h2>
            {inactiveWindows.map((w) => (
              <WindowRow key={w.windowId} window={w} onDeactivate={null} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
};

const WindowRow = ({ window: w, onDeactivate }) => {
  const typeLabel = OPERATION_TYPES.find((t) => t.value === w.operationType)?.label ?? w.operationType;
  const now = new Date();
  const isOpen = w.isActive && new Date(w.startsAt) <= now && new Date(w.endsAt) >= now;

  return (
    <div style={{
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

      {onDeactivate && w.isActive && (
        <button
          onClick={() => onDeactivate(w.windowId)}
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
};

const labelStyle = {
  display: 'block',
  fontSize: '14px',
  fontWeight: '600',
  marginBottom: '6px',
  color: '#24292e',
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5da',
  borderRadius: '6px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

export default CoordinatorPanel;
