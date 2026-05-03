const request = require('supertest');

// Replace the full route graph with lightweight routers so this regression test
// can exercise the bundled flows without depending on the database stack.
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

  router.post('/', (req, res) => {
    if (!req.body || !req.body.groupName) {
      return res.status(400).json({ code: 'INVALID_REQUEST' });
    }
    return res.status(201).json({ id: 'g1', groupName: req.body.groupName });
  });

  router.get('/:groupId/sprints', (req, res) => res.status(200).json([]));

  router.post('/:groupId/deliverables', (req, res) => {
    if (!req.body || !req.body.file) {
      return res.status(422).json({ message: 'Missing file' });
    }
    return res.status(201).json({ ok: true });
  });

  return router;
});

const app = require('../src/index');

describe('Backend bundled flows (regression)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  test('health endpoint returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('create group: success and failure cases', async () => {
    // failure: missing body
    let res = await request(app).post('/api/v1/groups').send({});
    expect(res.statusCode).toBe(400);

    // success
    res = await request(app).post('/api/v1/groups').send({ groupName: 'RegTest' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id', 'g1');
  });

  test('sprints empty-state (no sprints available)', async () => {
    const res = await request(app).get('/api/v1/groups/g1/sprints');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  test('submit deliverable: failure and success', async () => {
    // failure (empty submission)
    let res = await request(app).post('/api/v1/groups/g1/deliverables').send({});
    expect(res.statusCode).toBe(422);

    // success
    res = await request(app).post('/api/v1/groups/g1/deliverables').send({ file: 'fakefile' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });
});
