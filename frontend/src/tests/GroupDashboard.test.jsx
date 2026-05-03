import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import GroupDashboard from '../components/GroupDashboard';

// Mock react-router params/navigation
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useParams: () => ({ group_id: 'g1' }),
  useNavigate: () => mockNavigate,
  Link: ({ children }) => children,
}));

// Mock auth store
jest.mock('../store/authStore', () => {
  let state = { user: null };
  const fn = (selector) => selector(state);
  fn.setState = (s) => { state = s; };
  return fn;
});

// Mock group store with mutable state for empty-state vs assigned-advisor scenarios
jest.mock('../store/groupStore', () => {
  let state = {
    groupData: {
      groupId: 'g1',
      groupName: 'Test Group',
      advisorId: 'a1',
      leaderId: 'u1',
      status: 'active',
    },
    committeeStatus: {},
    members: [],
    github: {},
    jira: {},
    pendingApprovalsCount: 0,
    isLoading: false,
    lastUpdated: null,
    fetchGroupDashboard: jest.fn(),
    startPolling: jest.fn(() => 42),
    stopPolling: jest.fn(),
  };
  const store = () => state;
  store.setState = (nextState) => {
    state = nextState;
  };
  return store;
});

// Mock API helpers
const mockRelease = jest.fn();
jest.mock('../api/advisorService', () => ({ releaseAdvisor: (...args) => mockRelease(...args) }));
jest.mock('../api/groupService', () => ({
  submitMembershipDecision: jest.fn(),
  getMyPendingInvitation: jest.fn(() => Promise.resolve(null)),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('renders dashboard and handles release success flow', async () => {
  const useAuthStore = require('../store/authStore');
  useAuthStore.setState({ user: { userId: 'u1', role: 'student' } });
  const useGroupStore = require('../store/groupStore');
  useGroupStore.setState({
    groupData: {
      groupId: 'g1',
      groupName: 'Test Group',
      advisorId: 'a1',
      leaderId: 'u1',
      status: 'active',
    },
    committeeStatus: {},
    members: [],
    github: {},
    jira: {},
    pendingApprovalsCount: 0,
    isLoading: false,
    lastUpdated: null,
    fetchGroupDashboard: jest.fn(),
    startPolling: jest.fn(() => 42),
    stopPolling: jest.fn(),
  });

  mockRelease.mockResolvedValueOnce({});

  render(<GroupDashboard />);

  // Release button exists under assigned advisor
  const releaseBtn = await screen.findByRole('button', { name: /Release/i });
  fireEvent.click(releaseBtn);

  const confirm = await screen.findByRole('button', { name: /Confirm Release/i });
  fireEvent.click(confirm);

  await waitFor(() => expect(mockRelease).toHaveBeenCalledWith('g1', ''));
});

test('shows release error message on 403', async () => {
  const useAuthStore = require('../store/authStore');
  useAuthStore.setState({ user: { userId: 'u1', role: 'student' } });
  const useGroupStore = require('../store/groupStore');
  useGroupStore.setState({
    groupData: {
      groupId: 'g1',
      groupName: 'Test Group',
      advisorId: 'a1',
      leaderId: 'u1',
      status: 'active',
    },
    committeeStatus: {},
    members: [],
    github: {},
    jira: {},
    pendingApprovalsCount: 0,
    isLoading: false,
    lastUpdated: null,
    fetchGroupDashboard: jest.fn(),
    startPolling: jest.fn(() => 42),
    stopPolling: jest.fn(),
  });

  mockRelease.mockRejectedValueOnce({ response: { status: 403 } });

  render(<GroupDashboard />);

  fireEvent.click(await screen.findByRole('button', { name: /Release/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Confirm Release/i }));

  await waitFor(() => screen.getByText(/You are not authorized to release this advisor/i));
});

test('empty-state shows request advisor button for leader', async () => {
  const useAuthStore = require('../store/authStore');
  useAuthStore.setState({ user: { userId: 'u1', role: 'student' } });
  const useGroupStore = require('../store/groupStore');
  useGroupStore.setState({
    groupData: { groupId: 'g1', groupName: 'Test Group', leaderId: 'u1', status: 'active' },
    committeeStatus: {},
    members: [],
    github: {},
    jira: {},
    pendingApprovalsCount: 0,
    isLoading: false,
    lastUpdated: null,
    fetchGroupDashboard: jest.fn(),
    startPolling: jest.fn(() => 42),
    stopPolling: jest.fn(),
  });

  render(<GroupDashboard />);

  expect(await screen.findByRole('button', { name: /Request Advisor/i })).toBeTruthy();
});
