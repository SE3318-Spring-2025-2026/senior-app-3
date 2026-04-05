import create from 'zustand';
import * as groupService from '../api/groupService';

/**
 * Group Store - Manages group dashboard state
 */
const useGroupStore = create((set, get) => ({
  // State
  groupData: null,
  members: [],
  github: { connected: false, repo_url: null, last_synced: null },
  jira: { connected: false, project_key: null, board_url: null },
  pendingApprovalsCount: 0,
  isLoading: false,
  error: null,
  lastUpdated: null,

  // Actions
  /**
   * Fetch group dashboard data
   */
  fetchGroupDashboard: async (groupId) => {
    set({ isLoading: true, error: null });
    try {
      const data = await groupService.getGroupDashboardData(groupId);
      
      // Extract pending approvals count
      const approvalsArray = data.approvals?.approvals || data.approvals || [];
      const pendingCount = Array.isArray(approvalsArray)
        ? approvalsArray.filter(a => a.status === 'pending').length
        : 0;

      set({
        groupData: data.group,
        members: data.members?.members || data.members || [],
        github: data.github || { connected: false },
        jira: data.jira || { connected: false },
        pendingApprovalsCount: pendingCount,
        isLoading: false,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      set({
        error: error.message || 'Failed to fetch group data',
        isLoading: false,
      });
    }
  },

  /**
   * Set polling interval for auto-refresh
   */
  startPolling: (groupId, intervalMs = 30000) => {
    const { fetchGroupDashboard } = get();
    
    // Initial fetch
    fetchGroupDashboard(groupId);

    // Set up polling interval
    const intervalId = setInterval(() => {
      fetchGroupDashboard(groupId);
    }, intervalMs);

    return intervalId;
  },

  /**
   * Stop polling
   */
  stopPolling: (intervalId) => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  },

  /**
   * Clear state
   */
  clearGroupData: () => {
    set({
      groupData: null,
      members: [],
      github: { connected: false },
      jira: { connected: false },
      pendingApprovalsCount: 0,
      error: null,
      lastUpdated: null,
    });
  },

  /**
   * Set loading state
   */
  setLoading: (isLoading) => {
    set({ isLoading });
  },

  /**
   * Set error
   */
  setError: (error) => {
    set({ error });
  },
}));

export default useGroupStore;
