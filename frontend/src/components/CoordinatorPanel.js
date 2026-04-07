import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  listScheduleWindows,
  createScheduleWindow,
  deactivateScheduleWindow,
} from '../api/groupService';

const OPERATION_LABELS = {
  group_creation: 'Group Creation',
  member_addition: 'Member Addition',
};

const toLocalDatetimeValue = (date) => {
  if (!date) return '';
  const d = new Date(date);
  // Format as YYYY-MM-DDTHH:mm for datetime-local input
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const WindowCard = ({ operationType, windows, onDeactivate }) => {
  const now = new Date();
  const activeWindow = windows.find(
    (w) => w.isActive && new Date(w.startsAt) <= now && new Date(w.endsAt) >= now
  );

  return (
    <div style={{ marginBottom: '8px' }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', color: '#444' }}>
        {OPERATION_LABELS[operationType]}
      </h3>
      {activeWindow ? (
        <div style={{
          padding: '12px',
          background: '#e6f4ea',
          borderRadius: '6px',
          border: '1px solid #34a853',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <span style={{ color: '#1e7e34', fontWeight: 600, fontSize: '13px' }}>OPEN</span>
            {activeWindow.label && (
              <span style={{ marginLeft: '8px', color: '#555', fontSize: '13px' }}>{activeWindow.label}</span>
            )}
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              {new Date(activeWindow.startsAt).toLocaleString()} – {new Date(activeWindow.endsAt).toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => onDeactivate(activeWindow.windowId)}
            style={{
              padding: '6px 12px',
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Close Window
          </button>
        </div>
      ) : (
        <div style={{
          padding: '12px',
          background: '#fdf3f3',
          borderRadius: '6px',
          border: '1px solid #e57373',
          fontSize: '13px',
          color: '#c62828',
          fontWeight: 600,
        }}>
          CLOSED — no active window
        </div>
      )}
    </div>
  );
};

const WindowForm = ({ operationType, onCreated }) => {
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!startsAt || !endsAt) {
      setError('Both start and end times are required.');
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('End time must be after start time.');
      return;
    }
    setLoading(true);
    try {
      await createScheduleWindow({
        operationType,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        label: label.trim() || undefined,
      });
      setStartsAt('');
      setEndsAt('');
      setLabel('');
      onCreated();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create schedule window.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>
            Open At
          </label>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>
            Close At
          </label>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
          />
        </div>
      </div>
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>
          Label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`e.g. Spring 2026 – ${OPERATION_LABELS[operationType]}`}
          style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
        />
      </div>
      {error && (
        <p style={{ color: '#dc3545', fontSize: '12px', margin: '0 0 8px 0' }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        style={{
          padding: '7px 16px',
          background: '#0366d6',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Saving…' : 'Set Window'}
      </button>
    </form>
  );
};

const CoordinatorPanel = () => {
  const { group_id: groupId } = useParams();
  const navigate = useNavigate();

  const [windows, setWindows] = useState([]);
  const [loadError, setLoadError] = useState('');

  const fetchWindows = useCallback(async () => {
    setLoadError('');
    try {
      const data = await listScheduleWindows();
      setWindows(data.windows || []);
    } catch (err) {
      setLoadError('Failed to load schedule windows.');
    }
  }, []);

  useEffect(() => {
    fetchWindows();
  }, [fetchWindows]);

  const handleDeactivate = async (windowId) => {
    try {
      await deactivateScheduleWindow(windowId);
      fetchWindows();
    } catch {
      setLoadError('Failed to close window.');
    }
  };

  const windowsByType = (type) => windows.filter((w) => w.operationType === type);

  return (
    <div className="page" style={{ padding: '24px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <button
          onClick={() => navigate(`/groups/${groupId}`)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#e1e4e8',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            marginBottom: '20px',
          }}
        >
          ← Back to Group Dashboard
        </button>

        <h1 style={{ marginTop: 0, marginBottom: '24px', fontSize: '22px' }}>
          Coordinator Panel — Group {groupId}
        </h1>

        {loadError && (
          <p style={{ color: '#dc3545', marginBottom: '16px' }}>{loadError}</p>
        )}

        {/* Schedule Windows Configuration */}
        <div style={{
          background: 'white',
          padding: '24px',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          marginBottom: '24px',
        }}>
          <h2 style={{ marginTop: 0, fontSize: '18px', marginBottom: '20px' }}>
            Schedule Windows
          </h2>

          {['group_creation', 'member_addition'].map((opType) => (
            <div
              key={opType}
              style={{
                padding: '16px',
                border: '1px solid #e1e4e8',
                borderRadius: '6px',
                marginBottom: '16px',
              }}
            >
              <WindowCard
                operationType={opType}
                windows={windowsByType(opType)}
                onDeactivate={handleDeactivate}
              />
              <WindowForm operationType={opType} onCreated={fetchWindows} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CoordinatorPanel;
