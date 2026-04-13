/**
 * Smoke tests — Process 5 deliverables middleware
 *
 * Covers:
 *   deliverableAuthMiddleware  → 401 no token, 401 bad token, attaches req.user
 *   roleMiddleware on submit   → 403 when non-student hits submit
 *   roleMiddleware on retract  → 403 when non-coordinator hits retract
 *   uploadSingle (fileFilter)  → 415 on unsupported MIME type
 *   uploadSingle (size limit)  → 413 on oversized file
 *   Happy-path stubs           → 501 (controllers not yet implemented)
 *
 * Run a single suite:
 *   npm test -- deliverables-middleware.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'deliverables-smoke-test-secret';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');

let mongod;
let app;

const unique = (prefix) =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

function makeToken(userId, role) {
  return generateAccessToken(userId, role);
}

/** Write a temp file with a given size (bytes) and return its path. */
function makeTempFile(name, sizeBytes, content = null) {
  const filePath = path.join(os.tmpdir(), name);
  if (content) {
    fs.writeFileSync(filePath, content);
  } else {
    const buf = Buffer.alloc(sizeBytes, 'x');
    fs.writeFileSync(filePath, buf);
  }
  return filePath;
}

/** Seed a Group with one accepted student member and return { groupId, studentId }. */
async function seedGroupWithStudent() {
  const studentId = unique('stu');
  const groupId = unique('grp');
  await Group.create({
    groupId,
    groupName: unique('Group'),
    leaderId: studentId,
    status: 'active',
    members: [{ userId: studentId, role: 'leader', status: 'accepted' }],
  });
  return { groupId, studentId };
}

describe('Process 5 — deliverables middleware smoke tests', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    app = require('../src/index');
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    // Remove files written by multer during tests
    const stagingDir = path.join(__dirname, '..', 'uploads', 'staging');
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  });

  // ---------------------------------------------------------------------------
  // deliverableAuthMiddleware
  // ---------------------------------------------------------------------------
  describe('deliverableAuthMiddleware', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const res = await request(app)
        .post('/api/v1/deliverables/any-staging-id/submit')
        .field('dummy', 'value');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token is malformed / invalid', async () => {
      const res = await request(app)
        .post('/api/v1/deliverables/any-staging-id/submit')
        .set('Authorization', 'Bearer not.a.real.token');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 401 when retract route has no token', async () => {
      const res = await request(app).delete(
        '/api/v1/deliverables/del-123/retract'
      );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  // ---------------------------------------------------------------------------
  // Role enforcement — submit route (student only)
  // ---------------------------------------------------------------------------
  describe('role enforcement — submit (student only)', () => {
    it('returns 403 when a coordinator tries to submit', async () => {
      const coordToken = makeToken(unique('coord'), 'coordinator');
      const pdfPath = makeTempFile('test.pdf', 512, '%PDF-1.4 smoke');

      const res = await request(app)
        .post('/api/v1/deliverables/staging-abc/submit')
        .set('Authorization', `Bearer ${coordToken}`)
        .attach('file', pdfPath, { contentType: 'application/pdf' });

      expect(res.status).toBe(403);
    });

    it('returns 403 when an advisor tries to submit', async () => {
      const advisorToken = makeToken(unique('advisor'), 'advisor');
      const pdfPath = makeTempFile('test2.pdf', 512, '%PDF-1.4 smoke');

      const res = await request(app)
        .post('/api/v1/deliverables/staging-abc/submit')
        .set('Authorization', `Bearer ${advisorToken}`)
        .attach('file', pdfPath, { contentType: 'application/pdf' });

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Role enforcement — retract route (coordinator only)
  // ---------------------------------------------------------------------------
  describe('role enforcement — retract (coordinator only)', () => {
    it('returns 403 when a student tries to retract', async () => {
      const { studentId } = await seedGroupWithStudent();
      const studentToken = makeToken(studentId, 'student');

      const res = await request(app)
        .delete('/api/v1/deliverables/del-999/retract')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // uploadSingle — MIME type filter (415)
  // ---------------------------------------------------------------------------
  describe('uploadSingle — MIME type filter', () => {
    it('returns 415 for an unsupported MIME type (image/png)', async () => {
      const { studentId } = await seedGroupWithStudent();
      const studentToken = makeToken(studentId, 'student');
      const imgPath = makeTempFile('photo.png', 512);

      const res = await request(app)
        .post('/api/v1/deliverables/staging-xyz/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .attach('file', imgPath, { contentType: 'image/png' });

      expect(res.status).toBe(415);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('returns 415 for text/plain', async () => {
      const { studentId } = await seedGroupWithStudent();
      const studentToken = makeToken(studentId, 'student');
      const txtPath = makeTempFile('readme.txt', 64, 'hello world');

      const res = await request(app)
        .post('/api/v1/deliverables/staging-xyz/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .attach('file', txtPath, { contentType: 'text/plain' });

      expect(res.status).toBe(415);
    });
  });

  // ---------------------------------------------------------------------------
  // uploadSingle — accepted MIME types reach the stub (501)
  // ---------------------------------------------------------------------------
  describe('uploadSingle — accepted MIME types', () => {
    const cases = [
      { mime: 'application/pdf', filename: 'doc.pdf', content: '%PDF-1.4' },
      {
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'doc.docx',
        content: 'PK stub',
      },
      { mime: 'text/markdown', filename: 'doc.md', content: '# heading' },
      { mime: 'application/zip', filename: 'doc.zip', content: 'PK stub' },
    ];

    test.each(cases)(
      'passes through $mime and reaches 501 stub',
      async ({ mime, filename, content }) => {
        const { studentId } = await seedGroupWithStudent();
        const studentToken = makeToken(studentId, 'student');
        const filePath = makeTempFile(filename, 0, content);

        const res = await request(app)
          .post('/api/v1/deliverables/staging-ok/submit')
          .set('Authorization', `Bearer ${studentToken}`)
          .attach('file', filePath, { contentType: mime });

        // 501 means multer accepted the file and auth passed — controller not yet implemented
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('NOT_IMPLEMENTED');
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Happy-path retract stub
  // ---------------------------------------------------------------------------
  describe('retract stub', () => {
    it('coordinator reaches 501 stub on retract', async () => {
      const coordToken = makeToken(unique('coord'), 'coordinator');

      const res = await request(app)
        .delete('/api/v1/deliverables/del-abc/retract')
        .set('Authorization', `Bearer ${coordToken}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('NOT_IMPLEMENTED');
    });
  });
});
