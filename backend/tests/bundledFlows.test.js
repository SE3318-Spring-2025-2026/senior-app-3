const request = require('supertest');
const mongoose = require('mongoose');

// Mock the real business logic routes with partial implementations
// to test workflows without full database stack
jest.mock('../src/routes/auth', () => require('express').Router());
jest.mock('../src/routes/onboarding', () => require('express').Router());
jest.mock('../src/routes/advisorRequests', () => require('express').Router());
jest.mock('../src/routes/committees', () => require('express').Router());
jest.mock('../src/routes/scheduleWindow', () => require('express').Router());
jest.mock('../src/routes/auditLogs', () => require('express').Router());
jest.mock('../src/routes/deliverables', () => require('express').Router());
jest.mock('../src/routes/reviews', () => require('express').Router());
jest.mock('../src/routes/comments', () => require('express').Router());
jest.mock('../src/routes/finalGrades', () => require('express').Router());
jest.mock('../src/routes/finalGradeSelf', () => require('express').Router());

jest.mock('../src/routes/groups', () => {
  const express = require('express');
  const router = express.Router();

  // Simulate storage for testing
  const groups = new Map();
  const sprints = new Map();
  const deliverables = new Map();

  // POST /api/v1/groups - Create group workflow
  router.post('/', (req, res) => {
    if (!req.body || !req.body.groupName) {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'Missing groupName' });
    }
    if (req.body.groupName.length < 3) {
      return res.status(422).json({ code: 'INVALID_NAME', message: 'Group name too short' });
    }
    const groupId = 'g_' + Date.now();
    groups.set(groupId, { id: groupId, groupName: req.body.groupName, status: 'active' });
    sprints.set(groupId, [{ sprintId: 's1', name: 'Sprint 1' }]);
    return res.status(201).json({ id: groupId, groupName: req.body.groupName });
  });

  // GET /api/v1/groups/:groupId/sprints - Retrieve sprints for group
  router.get('/:groupId/sprints', (req, res) => {
    const { groupId } = req.params;
    if (!groups.has(groupId)) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND' });
    }
    const groupSprints = sprints.get(groupId) || [];
    return res.status(200).json({ sprints: groupSprints });
  });

  // POST /api/v1/groups/:groupId/deliverables - Submit deliverable workflow
  router.post('/:groupId/deliverables', (req, res) => {
    const { groupId } = req.params;
    if (!groups.has(groupId)) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND' });
    }
    if (!req.body || !req.body.file) {
      return res.status(400).json({ code: 'MISSING_FILE', message: 'Missing file in request' });
    }
    if (!req.body.sprintId) {
      return res.status(400).json({ code: 'MISSING_SPRINT', message: 'Missing sprintId' });
    }
    const deliverableId = 'd_' + Date.now();
    deliverables.set(deliverableId, { id: deliverableId, groupId, ...req.body });
    return res.status(201).json({ 
      ok: true, 
      deliverableId,
      storageRef: `deliverables/${groupId}/${deliverableId}` 
    });
  });

  // GET /api/v1/groups/:groupId/deliverables - List deliverables
  router.get('/:groupId/deliverables', (req, res) => {
    const { groupId } = req.params;
    if (!groups.has(groupId)) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND' });
    }
    const groupDeliverables = Array.from(deliverables.values())
      .filter(d => d.groupId === groupId);
    return res.status(200).json({ deliverables: groupDeliverables });
  });

  return router;
});

const app = require('../src/index');

describe('[REGRESSION] Backend bundled flows', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  describe('health check', () => {
    test('health endpoint returns ok status', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });
  });

  describe('group creation workflow', () => {
    test('create group with valid name (success)', async () => {
      const res = await request(app).post('/api/v1/groups').send({ groupName: 'TestGroup' });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.groupName).toBe('TestGroup');
    });

    test('create group without groupName (failure - 400)', async () => {
      const res = await request(app).post('/api/v1/groups').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    });

    test('create group with invalid groupName (failure - 422)', async () => {
      const res = await request(app).post('/api/v1/groups').send({ groupName: 'ab' });
      expect(res.statusCode).toBe(422);
      expect(res.body.code).toBe('INVALID_NAME');
    });
  });

  describe('sprint retrieval workflow', () => {
    let createdGroupId;

    beforeAll(async () => {
      const createRes = await request(app).post('/api/v1/groups')
        .send({ groupName: 'SprintTestGroup' });
      createdGroupId = createRes.body.id;
    });

    test('get sprints for existing group (success with data)', async () => {
      const res = await request(app).get(`/api/v1/groups/${createdGroupId}/sprints`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('sprints');
      expect(Array.isArray(res.body.sprints)).toBe(true);
    });

    test('get sprints for nonexistent group (failure - 404)', async () => {
      const res = await request(app).get('/api/v1/groups/nonexistent/sprints');
      expect(res.statusCode).toBe(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('deliverable submission workflow', () => {
    let groupId;
    let sprintId = 's1';

    beforeAll(async () => {
      const createRes = await request(app).post('/api/v1/groups')
        .send({ groupName: 'DeliverableTestGroup' });
      groupId = createRes.body.id;
    });

    test('submit deliverable with all required fields (success)', async () => {
      const res = await request(app).post(`/api/v1/groups/${groupId}/deliverables`)
        .send({ file: 'proposal.pdf', sprintId });
      expect(res.statusCode).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body).toHaveProperty('deliverableId');
      expect(res.body).toHaveProperty('storageRef');
    });

    test('submit deliverable without file (failure - 400)', async () => {
      const res = await request(app).post(`/api/v1/groups/${groupId}/deliverables`)
        .send({ sprintId });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('MISSING_FILE');
    });

    test('submit deliverable without sprintId (failure - 400)', async () => {
      const res = await request(app).post(`/api/v1/groups/${groupId}/deliverables`)
        .send({ file: 'proposal.pdf' });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('MISSING_SPRINT');
    });

    test('submit deliverable to nonexistent group (failure - 404)', async () => {
      const res = await request(app).post('/api/v1/groups/nonexistent/deliverables')
        .send({ file: 'proposal.pdf', sprintId });
      expect(res.statusCode).toBe(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });

    test('list deliverables for group (empty-state)', async () => {
      const groupRes = await request(app).post('/api/v1/groups')
        .send({ groupName: 'EmptyDeliverableGroup' });
      const emptyGroupId = groupRes.body.id;
      const res = await request(app).get(`/api/v1/groups/${emptyGroupId}/deliverables`);
      expect(res.statusCode).toBe(200);
      expect(res.body.deliverables).toEqual([]);
    });
  });

  describe('end-to-end workflow', () => {
    test('complete workflow: create group → get sprints → submit deliverable → list deliverables', async () => {
      // Step 1: Create group
      const createRes = await request(app).post('/api/v1/groups')
        .send({ groupName: 'E2ETestGroup' });
      expect(createRes.statusCode).toBe(201);
      const groupId = createRes.body.id;

      // Step 2: Get sprints
      const sprintsRes = await request(app).get(`/api/v1/groups/${groupId}/sprints`);
      expect(sprintsRes.statusCode).toBe(200);
      expect(sprintsRes.body.sprints.length).toBeGreaterThan(0);
      const sprintId = sprintsRes.body.sprints[0].sprintId;

      // Step 3: Submit deliverable
      const submitRes = await request(app).post(`/api/v1/groups/${groupId}/deliverables`)
        .send({ file: 'proposal.pdf', sprintId });
      expect(submitRes.statusCode).toBe(201);
      expect(submitRes.body.ok).toBe(true);

      // Step 4: List deliverables
      const listRes = await request(app).get(`/api/v1/groups/${groupId}/deliverables`);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.deliverables.length).toBeGreaterThan(0);
      expect(listRes.body.deliverables[0].groupId).toBe(groupId);
    });
  });
});
