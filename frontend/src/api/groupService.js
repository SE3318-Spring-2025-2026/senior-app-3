import apiClient from './apiClient';

/**
 * Group Service - Handles all group-related API calls
 */

/**
 * Get group details
 * @param {string} groupId - The group ID
 * @returns {Promise} Group data
 */
export const getGroup = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching group:', error);
    throw error;
  }
};

/**
 * Get group members
 * @param {string} groupId - The group ID
 * @returns {Promise} List of group members
 */
export const getGroupMembers = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}/members`);
    return response.data;
  } catch (error) {
    console.error('Error fetching group members:', error);
    throw error;
  }
};

/**
 * Get GitHub integration status
 * @param {string} groupId - The group ID
 * @returns {Promise} GitHub integration details
 */
export const getGitHubStatus = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}/github`);
    return response.data;
  } catch (error) {
    console.error('Error fetching GitHub status:', error);
    // Return default if endpoint not found
    if (error.response?.status === 404) {
      return { connected: false, repo_url: null, last_synced: null };
    }
    throw error;
  }
};

/**
 * Get JIRA integration status
 * @param {string} groupId - The group ID
 * @returns {Promise} JIRA integration details
 */
export const getJiraStatus = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}/jira`);
    return response.data;
  } catch (error) {
    console.error('Error fetching JIRA status:', error);
    // Return default if endpoint not found
    if (error.response?.status === 404) {
      return { connected: false, project_key: null, board_url: null };
    }
    throw error;
  }
};

/**
 * Get pending approvals for the group
 * @param {string} groupId - The group ID
 * @returns {Promise} List of pending approvals
 */
export const getPendingApprovals = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}/approvals`, {
      params: { status: 'pending' }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    // Return empty array if endpoint not found
    if (error.response?.status === 404) {
      return { approvals: [] };
    }
    throw error;
  }
};

/**
 * Get all group data at once (dashboard view)
 * @param {string} groupId - The group ID
 * @returns {Promise} All dashboard data
 */
export const getGroupDashboardData = async (groupId) => {
  try {
    const [groupData, membersData, githubData, jiraData, approvalsData] = await Promise.all([
      getGroup(groupId),
      // getGroupMembers(groupId),
      // getGitHubStatus(groupId),
      // getJiraStatus(groupId),
      // getPendingApprovals(groupId),
    ]);

    return {
      group: groupData,
      members: membersData,
      github: githubData,
      jira: jiraData,
      approvals: approvalsData,
    };
  } catch (error) {
    console.error('Error fetching group dashboard data:', error);
    throw error;
  }
};
