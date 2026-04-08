import apiClient from './apiClient';

/**
 * Group Service - Handles all group-related API calls
 */

/**
 * Create a new group (Process 2.1 → 2.2, flow f01/f02)
 * @param {object} payload
 * @param {string} payload.groupName   - Required
 * @param {string} payload.leaderId    - Required, must match authenticated user
 * @param {string} [payload.githubPat]
 * @param {string} [payload.githubOrg]
 * @param {string} [payload.jiraUrl]
 * @param {string} [payload.jiraUsername]
 * @param {string} [payload.jiraToken]
 * @param {string} [payload.projectKey]
 * @returns {Promise<{groupId, groupName, leaderId, status, createdAt}>}
 */
export const createGroup = async ({
  groupName,
  leaderId,
  githubPat,
  githubOrg,
  jiraUrl,
  jiraUsername,
  jiraToken,
  projectKey,
}) => {
  const response = await apiClient.post('/groups', {
    groupName,
    leaderId,
    githubPat: githubPat || undefined,
    githubOrg: githubOrg || undefined,
    jiraUrl: jiraUrl || undefined,
    jiraUsername: jiraUsername || undefined,
    jiraToken: jiraToken || undefined,
    projectKey: projectKey || undefined,
  });
  return response.data;
};

/**
 * Check if a schedule window is currently open for a given operation type
 * @param {'group_creation'|'member_addition'} operationType
 * @returns {Promise<{open: boolean, window: object|null}>}
 */
export const getScheduleWindow = async (operationType = 'group_creation') => {
  try {
    const response = await apiClient.get('/schedule-window/active', {
      params: { operationType },
    });
    return response.data;
  } catch {
    return { open: false, window: null };
  }
};

/**
 * List all schedule windows (coordinator/admin only)
 * @param {'group_creation'|'member_addition'|undefined} operationType — optional filter
 * @returns {Promise<{windows: object[]}>}
 */
export const listScheduleWindows = async (operationType) => {
  const params = operationType ? { operationType } : {};
  const response = await apiClient.get('/schedule-window', { params });
  return response.data;
};

/**
 * Create a new schedule window (coordinator/admin only)
 * @param {'group_creation'|'member_addition'} operationType
 * @param {string} startsAt - ISO date string
 * @param {string} endsAt - ISO date string
 * @param {string} [label]
 * @returns {Promise<object>} Created window
 */
export const createScheduleWindow = async (operationType, startsAt, endsAt, label = '') => {
  const response = await apiClient.post('/schedule-window', {
    operationType,
    startsAt,
    endsAt,
    label,
  });
  return response.data;
};

/**
 * Deactivate a schedule window (coordinator/admin only)
 * @param {string} windowId
 * @returns {Promise<{windowId: string, isActive: false}>}
 */
export const deactivateScheduleWindow = async (windowId) => {
  const response = await apiClient.delete(`/schedule-window/${windowId}`);
  return response.data;
};

/**
 * Add members to a group (Process 2.3, flows f05, f06, f19, f32)
 * @param {string} groupId
 * @param {string[]} studentIds
 * @returns {Promise<{added: object[], errors: object[], group_id: string, total_members: number}>}
 */
export const addGroupMembers = async (groupId, studentIds) => {
  const response = await apiClient.post(`/groups/${groupId}/members`, {
    student_ids: studentIds,
  });
  return response.data;
};

/**
 * Get the current user's pending group invitation
 * @returns {Promise<{invitation_id, group_id, group_name, invited_by, status, created_at}|null>}
 */
export const getMyPendingInvitation = async () => {
  try {
    const response = await apiClient.get('/groups/pending-invitation');
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
};

/**
 * Accept or reject a group invitation
 * @param {string} groupId
 * @param {'accepted'|'rejected'} decision
 * @param {string} studentId - Must match the authenticated user
 * @param {string} [message] - Optional message accompanying the decision
 */
export const submitMembershipDecision = async (groupId, decision, studentId, message) => {
  const body = { decision, student_id: studentId };
  if (message) body.message = message;
  const response = await apiClient.post(`/groups/${groupId}/membership-decisions`, body);
  return response.data;
};

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
 * Get group committee status
 * @param {string} groupId - The group ID
 * @returns {Promise} Committee status object for the group
 */
export const getGroupCommitteeStatus = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}/committee-status`);
    return response.data;
  } catch (error) {
    console.error('Error fetching committee status:', error);
    throw error;
  }
};

/**
 * Get jury-assigned committees for the authenticated user
 * @returns {Promise<{committees: object[]}>}
 */
export const getJuryCommittees = async () => {
  try {
    const response = await apiClient.get('/jury/committees');
    return response.data;
  } catch (error) {
    console.error('Error fetching jury committees:', error);
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
    const [groupData, approvalsData, githubData, jiraData, committeeData] = await Promise.all([
      getGroup(groupId),
      apiClient.get(`/groups/${groupId}/approvals`).then((r) => r.data).catch(() => ({ approvals: [] })),
      getGitHubStatus(groupId).catch(() => ({ connected: false, repo_url: null, last_synced: null })),
      getJiraStatus(groupId).catch(() => ({ connected: false, project_key: null, board_url: null })),
      getGroupCommitteeStatus(groupId).catch(() => ({ groupId, committeeId: null, committee: null })),
    ]);

    return {
      group: groupData,
      members: groupData.members || [],
      github: githubData,
      jira: jiraData,
      approvals: approvalsData,
      committeeStatus: committeeData,
    };
  } catch (error) {
    console.error('Error fetching group dashboard data:', error);
    throw error;
  }
};

/**
 * Get all groups (coordinator only)
 * @returns {Promise<{groups: object[], total: number}>} List of all groups with status and integration info
 */
export const getAllGroups = async () => {
  const response = await apiClient.get('/groups');
  return response.data;
};

/**
 * Coordinator override: add or remove member, or update group fields
 * @param {string} groupId - The group ID
 * @param {object} payload
 * @param {'add_member'|'remove_member'|'update_group'} payload.action
 * @param {string} [payload.target_student_id] - Required for add_member / remove_member
 * @param {object} [payload.updates] - Required for update_group
 * @param {string} payload.reason - Required reason for override
 * @returns {Promise<{override_id, action, status, confirmation, timestamp}>}
 */
export const coordinatorOverride = async (groupId, payload) => {
  const response = await apiClient.patch(`/groups/${groupId}/override`, payload);
  return response.data;
};

/**
 * Get group status
 * @param {string} groupId - The group ID
 * @returns {Promise<{groupId, status, lastTransitionAt, lastTransitionBy}>}
 */
export const getGroupStatus = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}/status`);
    return response.data;
  } catch (error) {
    console.error('Error fetching group status:', error);
    throw error;
  }
};

/**
 * Transition group to a new status
 * @param {string} groupId - The group ID
 * @param {string} newStatus - The new status ('active', 'inactive', 'rejected', etc.)
 * @param {string} reason - Reason for status transition
 * @returns {Promise}
 */
export const transitionGroupStatus = async (groupId, newStatus, reason) => {
  const response = await apiClient.patch(`/groups/${groupId}/status`, {
    newStatus,
    reason,
  });
  return response.data;
};

/**
 * Configure GitHub integration for a group (Process 2.6)
 * @param {string} groupId - The group ID
 * @param {object} payload
 * @param {string} payload.pat - GitHub Personal Access Token
 * @param {string} payload.org_name - GitHub organization name
 * @param {string} payload.repo_name - Repository name
 * @param {string} [payload.visibility] - Visibility setting (private, public, internal); default: 'private'
 * @returns {Promise<{repo_url, status, org_data}>}
 */
export const configureGitHub = async (groupId, { pat, org_name, repo_name, visibility = 'private' }) => {
  try {
    const response = await apiClient.post(`/groups/${groupId}/github`, {
      pat,
      org_name,
      repo_name,
      visibility,
    });
    return response.data;
  } catch (error) {
    console.error('Error configuring GitHub:', error);
    throw error;
  }
};

/**
 * Configure JIRA integration for a group (Process 2.7)
 * @param {string} groupId - The group ID
 * @param {object} payload
 * @param {string} payload.host       - JIRA instance base URL
 * @param {string} payload.email      - JIRA account email
 * @param {string} payload.api_token  - JIRA API token
 * @param {string} payload.project_key - JIRA project key
 * @returns {Promise<{project_id, project_key, binding, board_url}>}
 */
export const configureJira = async (groupId, { host, email, api_token, project_key }) => {
  try {
    const response = await apiClient.post(`/groups/${groupId}/jira`, {
      host,
      email,
      api_token,
      project_key,
    });
    return response.data;
  } catch (error) {
    console.error('Error configuring JIRA:', error);
    throw error;
  }
};
