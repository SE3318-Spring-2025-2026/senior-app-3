'use strict';

const Group = require('../models/Group');
const { encrypt } = require('../utils/cryptoUtils');
const { createAuditLog } = require('./auditService');

async function overwriteGithubCredentials({
  group,
  pat,
  orgName,
  orgData,
  repoName,
  visibility,
  actorId,
  req,
}) {
  group.githubPat = encrypt(pat);
  group.githubOrg = orgName;
  group.githubOrgId = orgData.id;
  group.githubOrgName = orgData.name;
  group.githubRepoName = repoName;
  group.githubVisibility = visibility;
  group.githubRepoUrl = `https://github.com/${orgName}/${repoName}`;
  group.githubLastSynced = new Date();
  await group.save();

  await createAuditLog({
    action: 'CREDENTIAL_ROTATED',
    actorId,
    groupId: group.groupId,
    targetId: group.groupId,
    payload: {
      provider: 'github',
      reason: 'manual_update',
      repo: group.githubRepoUrl,
      keyVersion: 'v1',
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return group;
}

async function overwriteJiraCredentials({
  group,
  baseUrl,
  email,
  apiToken,
  projectKey,
  projectData,
  actorId,
  req,
}) {
  group.jiraUrl = baseUrl;
  group.jiraUsername = email;
  group.jiraToken = encrypt(apiToken);
  group.projectKey = projectKey;
  group.jiraProjectId = String(projectData.id);
  group.jiraProject = projectData.name || projectKey;
  group.jiraBoardUrl = `${baseUrl}/jira/software/projects/${projectKey}/boards`;
  group.jiraLastSynced = new Date();
  group.jiraStoryPointOnly = true;
  await group.save();

  await createAuditLog({
    action: 'CREDENTIAL_ROTATED',
    actorId,
    groupId: group.groupId,
    targetId: group.groupId,
    payload: {
      provider: 'jira',
      reason: 'manual_update',
      projectKey,
      keyVersion: 'v1',
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return group;
}

async function getGroupOrThrow(groupId) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    const error = new Error('Group not found');
    error.status = 404;
    error.code = 'GROUP_NOT_FOUND';
    throw error;
  }
  return group;
}

module.exports = {
  getGroupOrThrow,
  overwriteGithubCredentials,
  overwriteJiraCredentials,
};
