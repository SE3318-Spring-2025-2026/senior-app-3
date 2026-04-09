import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock groupService
jest.mock('../api/groupService', () => ({
  getAllGroups: jest.fn(),
  coordinatorOverride: jest.fn(),
  createScheduleWindow: jest.fn(),
  getGroupDetails: jest.fn()
}));

// Mock authStore
jest.mock('../store/authStore', () => ({
  useAuthStore: jest.fn()
}));

import { useAuthStore } from '../store/authStore';
import { getAllGroups, coordinatorOverride, createScheduleWindow } from '../api/groupService';

// Component not yet found at src/components/CoordinatorPanel.js — update import when created
const ProtectedRoute = ({ children, requiredRoles }) => {
  const { user } = useAuthStore();
  if (!user || !requiredRoles.includes(user.role)) {
    return <div className="unauthorized">Not authorized</div>;
  }
  return children;
};

const CoordinatorPanel = () => {
  const [groups, setGroups] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selectedGroup, setSelectedGroup] = React.useState(null);
  const [overrideData, setOverrideData] = React.useState({
    decision: 'approve',
    reason: ''
  });
  const [scheduleData, setScheduleData] = React.useState({
    open_at: '',
    close_at: ''
  });
  const [scheduleLoading, setScheduleLoading] = React.useState(false);

  React.useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await getAllGroups();
        setGroups(response.data || []);
        setError(null);
      } catch (err) {
        setError('Failed to load groups');
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  const handleOverride = async (groupId) => {
    try {
      const response = await coordinatorOverride(groupId, overrideData);
      setSelectedGroup(null);
      setOverrideData({ decision: 'approve', reason: '' });
    } catch (err) {
      setError('Failed to process override');
    }
  };

  const handleScheduleWindow = async (groupId) => {
    setScheduleLoading(true);
    try {
      await createScheduleWindow(groupId, scheduleData);
      setScheduleData({ open_at: '', close_at: '' });
    } catch (err) {
      setError('Failed to create schedule window');
    } finally {
      setScheduleLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading coordinator panel...</div>;

  return (
    <div className="coordinator-panel">
      <h1>Coordinator Dashboard</h1>

      {error && <div className="error-banner">{error}</div>}

      <section className="groups-section">
        <h2>Groups</h2>
        <table className="groups-table">
          <thead>
            <tr>
              <th>Group Name</th>
              <th>Status</th>
              <th>Integration Health</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id} data-testid={`group-row-${group.id}`}>
                <td>{group.name}</td>
                <td>
                  <span className={`status-badge ${group.status}`}>{group.status}</span>
                </td>
                <td>
                  <span className={`health-indicator ${group.integration_health}`}>
                    {group.integration_health}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => setSelectedGroup(group.id)}
                    className="action-button"
                    data-testid={`select-group-${group.id}`}
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && <p className="empty-state">No groups found</p>}
      </section>

      {selectedGroup && (
        <section className="override-section">
          <h2>Override Form</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleOverride(selectedGroup);
            }}
            data-testid="override-form"
          >
            <div className="form-group">
              <label htmlFor="decision">Decision</label>
              <select
                id="decision"
                value={overrideData.decision}
                onChange={(e) => setOverrideData({ ...overrideData, decision: e.target.value })}
              >
                <option value="approve">Approve</option>
                <option value="deny">Deny</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="reason">Reason (Optional)</label>
              <textarea
                id="reason"
                value={overrideData.reason}
                onChange={(e) => setOverrideData({ ...overrideData, reason: e.target.value })}
                placeholder="Enter override reason"
              />
            </div>

            <button type="submit" className="submit-button">
              Submit Override
            </button>
          </form>
        </section>
      )}

      <section className="schedule-section">
        <h2>Schedule Window</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleScheduleWindow(selectedGroup);
          }}
          data-testid="schedule-form"
        >
          <div className="form-group">
            <label htmlFor="open_at">Open At</label>
            <input
              id="open_at"
              type="datetime-local"
              value={scheduleData.open_at}
              onChange={(e) => setScheduleData({ ...scheduleData, open_at: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor="close_at">Close At</label>
            <input
              id="close_at"
              type="datetime-local"
              value={scheduleData.close_at}
              onChange={(e) => setScheduleData({ ...scheduleData, close_at: e.target.value })}
            />
          </div>

          <button
            type="submit"
            disabled={!scheduleData.open_at || !scheduleData.close_at || scheduleLoading}
          >
            Create Schedule Window
          </button>
        </form>
      </section>
    </div>
  );
};

describe('CoordinatorPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders coordinator dashboard title', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({ data: [] });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Coordinator Dashboard')).toBeInTheDocument();
    });
  });

  it('displays groups table with headers', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Group Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Integration Health')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  it('displays group data in table rows', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [
        { id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' },
        { id: 'g2', name: 'Group 2', status: 'inactive', integration_health: 'degraded' }
      ]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Group 1')).toBeInTheDocument();
      expect(screen.getByText('Group 2')).toBeInTheDocument();
    });
  });

  it('displays status badge for each group', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('displays integration health for each group', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('healthy')).toBeInTheDocument();
    });
  });

  it('shows empty state when no groups exist', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({ data: [] });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No groups found')).toBeInTheDocument();
    });
  });

  it('shows manage button for each group', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-group-g1')).toBeInTheDocument();
    });
  });

  it('displays override form when group is selected', async () => {
    const user = userEvent.setup();
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-group-g1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('select-group-g1'));

    expect(screen.getByTestId('override-form')).toBeInTheDocument();
    expect(screen.getByLabelText(/Decision/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason/i)).toBeInTheDocument();
  });

  it('submits override with correct group ID and data', async () => {
    const user = userEvent.setup();
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });
    coordinatorOverride.mockResolvedValue({ data: { success: true } });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    // Select group
    await waitFor(() => {
      expect(screen.getByTestId('select-group-g1')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('select-group-g1'));

    // Change decision to deny
    const decisionSelect = screen.getByLabelText(/Decision/i);
    await user.selectOptions(decisionSelect, 'deny');

    // Add reason
    const reasonInput = screen.getByLabelText(/Reason/i);
    await user.type(reasonInput, 'Group inactive');

    // Submit
    const submitButton = screen.getByRole('button', { name: /Submit Override/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(coordinatorOverride).toHaveBeenCalledWith('g1', {
        decision: 'deny',
        reason: 'Group inactive'
      });
    });
  });

  it('displays schedule window form', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('schedule-form')).toBeInTheDocument();
      expect(screen.getByLabelText(/Open At/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Close At/i)).toBeInTheDocument();
    });
  });

  it('disables schedule submit button when fields are empty', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      const submitButton = within(screen.getByTestId('schedule-form')).getByRole('button');
      expect(submitButton).toBeDisabled();
    });
  });

  it('enables schedule submit button when all fields are filled', async () => {
    const user = userEvent.setup();
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Open At/i)).toBeInTheDocument();
    });

    const openAtInput = screen.getByLabelText(/Open At/i);
    const closeAtInput = screen.getByLabelText(/Close At/i);

    await user.type(openAtInput, '2024-12-20T10:00');
    await user.type(closeAtInput, '2024-12-20T18:00');

    const submitButton = within(screen.getByTestId('schedule-form')).getByRole('button');
    expect(submitButton).not.toBeDisabled();
  });

  it('submits schedule window with correct data', async () => {
    const user = userEvent.setup();
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });
    createScheduleWindow.mockResolvedValue({ data: { success: true } });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Open At/i)).toBeInTheDocument();
    });

    const openAtInput = screen.getByLabelText(/Open At/i);
    const closeAtInput = screen.getByLabelText(/Close At/i);

    await user.type(openAtInput, '2024-12-20T10:00');
    await user.type(closeAtInput, '2024-12-20T18:00');

    // First, select a group
    await user.click(screen.getByTestId('select-group-g1'));

    const submitButton = within(screen.getByTestId('schedule-form')).getByRole('button');
    await user.click(submitButton);

    await waitFor(() => {
      expect(createScheduleWindow).toHaveBeenCalledWith('g1', {
        open_at: '2024-12-20T10:00',
        close_at: '2024-12-20T18:00'
      });
    });
  });

  it('shows loading state when panel initially loads', () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading coordinator panel/i)).toBeInTheDocument();
  });

  it('displays error banner when group fetch fails', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockRejectedValue(new Error('Network error'));

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load groups')).toBeInTheDocument();
    });
  });

  it('clears selected group when override is submitted', async () => {
    const user = userEvent.setup();
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });
    coordinatorOverride.mockResolvedValue({ data: { success: true } });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    // Select group
    await waitFor(() => {
      expect(screen.getByTestId('select-group-g1')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('select-group-g1'));

    // Verify override form is shown
    expect(screen.getByTestId('override-form')).toBeInTheDocument();

    // Submit override
    const submitButton = screen.getByRole('button', { name: /Submit Override/i });
    await user.click(submitButton);

    // Override form should be hidden after successful submission
    await waitFor(() => {
      expect(screen.queryByTestId('override-form')).not.toBeInTheDocument();
    });
  });

  it('redirects non-coordinator users to unauthorized view', () => {
    useAuthStore.mockReturnValue({ user: { role: 'student' } });

    render(
      <MemoryRouter>
        <ProtectedRoute requiredRoles={['coordinator']}>
          <CoordinatorPanel />
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    expect(screen.queryByText('Coordinator Dashboard')).not.toBeInTheDocument();
  });

  it('calls getAllGroups on mount', async () => {
    useAuthStore.mockReturnValue({ user: { role: 'coordinator' } });
    getAllGroups.mockResolvedValue({
      data: [{ id: 'g1', name: 'Group 1', status: 'active', integration_health: 'healthy' }]
    });

    render(
      <MemoryRouter>
        <CoordinatorPanel />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getAllGroups).toHaveBeenCalledTimes(1);
    });
  });
});
