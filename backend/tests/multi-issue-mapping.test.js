/**
 * multi-issue-mapping.test.js — Verification for [H1] Multi-Issue Mapping Data Loss
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ContributionRecord = require('../src/models/ContributionRecord');
const { githubSyncWorker } = require('../src/services/githubSyncService');
const GitHubSyncJob = require('../src/models/GitHubSyncJob');
const Group = require('../src/models/Group');
const SprintRecord = require('../src/models/SprintRecord');
const User = require('../src/models/User');
const { encrypt } = require('../src/utils/cryptoUtils');
const { generateAccessToken } = require('../src/utils/jwt');
const request = require('supertest');

// Mock axios for GitHub API calls
jest.mock('axios');
const axios = require('axios');

let app;

describe('Multi-Issue Mapping Verification', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = require('../src/index');
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('should store multiple jiraIssueKeys in ContributionRecord', async () => {
    const sprintId = 'spr-1';
    const studentId = 'stu-1';
    const groupId = 'grp-1';

    // Directly create a record with multiple keys to test the model
    const record = await ContributionRecord.create({
      sprintId,
      studentId,
      groupId,
      jiraIssueKeys: ['ISSUE-1', 'ISSUE-2'],
      storyPointsAssigned: 10,
    });

    expect(record.jiraIssueKeys).toContain('ISSUE-1');
    expect(record.jiraIssueKeys).toContain('ISSUE-2');
    expect(Array.isArray(record.jiraIssueKeys)).toBe(true);
  });

  it('githubSyncWorker should process all jiraIssueKeys', async () => {
    const sprintId = 'spr-2';
    const studentId = 'stu-2';
    const groupId = 'grp-2';
    const jobId = 'job-1';

    // Setup Group
    await Group.create({
      groupId,
      groupName: 'Test Group',
      leaderId: 'lead-1',
      status: 'active',
      githubOrg: 'org',
      githubRepoName: 'repo',
      githubPat: encrypt('pat'),
    });

    // Setup SprintRecord
    await SprintRecord.create({
      sprintId,
      groupId,
      deliverableRefs: [],
    });

    // Setup ContributionRecord with 2 keys
    await ContributionRecord.create({
      sprintId,
      studentId,
      groupId,
      jiraIssueKeys: ['ISSUE-A', 'ISSUE-B'],
    });

    // Setup GitHubSyncJob
    await GitHubSyncJob.create({
      jobId,
      groupId,
      sprintId,
      status: 'PENDING',
    });

    // Mock axios to return merged PR for ISSUE-A and NOT_FOUND for ISSUE-B
    axios.get.mockImplementation((url, config) => {
      if (config.params?.head?.includes('ISSUE-A')) {
        return Promise.resolve({
          data: [{ number: 1, html_url: 'url1', merged: true, merge_state: 'merged' }]
        });
      }
      return Promise.resolve({ data: [] });
    });

    // Run worker
    await githubSyncWorker(groupId, sprintId, jobId);

    // Verify job results
    const job = await GitHubSyncJob.findOne({ jobId });
    expect(job.status).toBe('COMPLETED');
    
    const issueA = job.validationRecords.find(r => r.issueKey === 'ISSUE-A');
    const issueB = job.validationRecords.find(r => r.issueKey === 'ISSUE-B');
    
    expect(issueA.mergeStatus).toBe('MERGED');
    expect(issueB.mergeStatus).toBe('UNKNOWN');
  });

  it('recalculateContributions should calculate proportional SP for multiple keys', async () => {
    const sprintId = 'spr-3';
    const groupId = 'grp-3';
    const studentId = 'stu-3';
    const coordinatorId = 'coord-1';

    // Setup Users
    await User.create({
      userId: studentId,
      email: 'stu3@test.com',
      role: 'student',
      accountStatus: 'active',
      hashedPassword: 'hash'
    });
    await User.create({
      userId: coordinatorId,
      email: 'coord1@test.com',
      role: 'coordinator',
      accountStatus: 'active',
      hashedPassword: 'hash'
    });

    const token = generateAccessToken(coordinatorId, 'coordinator');

    // Setup Group
    await Group.create({
      groupId,
      groupName: 'Test Group 3',
      leaderId: studentId,
      status: 'active',
      members: [{ userId: studentId, role: 'leader', status: 'accepted' }]
    });

    // Setup ContributionRecord with 2 keys and 10 SP
    await ContributionRecord.create({
      sprintId,
      studentId,
      groupId,
      jiraIssueKeys: ['ISSUE-1', 'ISSUE-2'],
      storyPointsAssigned: 10,
    });

    // Setup GitHubSyncJob with ISSUE-1 MERGED
    await GitHubSyncJob.create({
      jobId: 'job-sync-3',
      groupId,
      sprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'ISSUE-1',
          mergeStatus: 'MERGED',
          lastValidated: new Date()
        },
        {
          issueKey: 'ISSUE-2',
          mergeStatus: 'NOT_MERGED',
          lastValidated: new Date()
        }
      ]
    });

    const res = await request(app)
      .post(`/api/v1/groups/${groupId}/sprints/${sprintId}/contributions/recalculate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const contrib = res.body.contributions.find(c => c.studentId === studentId);
    
    // Proportional SP: (1 merged / 2 total) * 10 SP = 5 SP
    expect(contrib.completedStoryPoints).toBe(5);
    expect(contrib.mappingWarnings).toContain('Mapped issue ISSUE-2 is not merged in latest GitHub sync.');
  });
});
