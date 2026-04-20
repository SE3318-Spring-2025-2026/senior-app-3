/**
 * Seed a test student user + active group + committee + open schedule windows
 * for manual testing of:
 *   POST /api/v1/deliverables/validate-group    (Process 5.1)
 *   POST /api/v1/deliverables/submit            (Process 5.2)
 *   POST /api/v1/deliverables/:id/validate-format   (Process 5.3)
 *   POST /api/v1/deliverables/:id/validate-deadline (Process 5.4)
 *
 * Also seeds a SprintConfig (D8) record with a future deadline so Process 5.4
 * succeeds out of the box.
 *
 * Usage:
 *   node scripts/seed-test-student.js
 *
 * Safe to run multiple times — cleans up previous test data first.
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const User           = require('../src/models/User');
const Group          = require('../src/models/Group');
const Committee      = require('../src/models/Committee');
const ScheduleWindow = require('../src/models/ScheduleWindow');
const SprintConfig   = require('../src/models/SprintConfig');
const Deliverable    = require('../src/models/Deliverable');
const { hashPassword }        = require('../src/utils/password');
const { generateAccessToken } = require('../src/utils/jwt');

const MONGO_URI     = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';
const TEST_EMAIL    = 'test.student@example.edu.tr';
const TEST_PASSWORD = 'Test@1234';

async function run() {
  await mongoose.connect(MONGO_URI);

  // ── Clean up previous test data ───────────────────────────────────────────
  const existing = await User.findOne({ email: TEST_EMAIL });
  if (existing) {
    await Group.deleteOne({ leaderId: existing.userId });
    await User.deleteOne({ email: TEST_EMAIL });
  }
  await Group.deleteOne({ groupName: 'Test Group' });
  await Committee.deleteOne({ committeeName: 'Test Committee' });
  await ScheduleWindow.deleteMany({ createdBy: 'seed-test-student' });
  await SprintConfig.deleteMany({ sprintId: 'sprint_1' });
  await Deliverable.deleteMany({ groupId: /^grp_test_/ });

  // ── Create student user ───────────────────────────────────────────────────
  const userId = `usr_${uuidv4().split('-')[0]}`;
  const hashedPassword = await hashPassword(TEST_PASSWORD);

  await User.create({
    userId,
    email: TEST_EMAIL,
    hashedPassword,
    role: 'student',
    emailVerified: true,
    accountStatus: 'active',
  });

  // ── Create committee ──────────────────────────────────────────────────────
  const committeeId = `cmt_test_${uuidv4().split('-')[0]}`;
  await Committee.create({
    committeeId,
    committeeName: 'Test Committee',
    createdBy: 'coordinator_test',
    status: 'published',
    advisorIds: [`adv_test_${uuidv4().split('-')[0]}`],
    juryIds: [],
  });

  // ── Create active group with the student as accepted leader ──────────────
  const groupId = `grp_test_${uuidv4().split('-')[0]}`;
  await Group.create({
    groupId,
    groupName: 'Test Group',
    leaderId: userId,
    status: 'active',
    committeeId,
    members: [{ userId, role: 'leader', status: 'accepted' }],
  });

  // ── Open schedule windows (1 year from now) ───────────────────────────────
  const startsAt = new Date(Date.now() - 60 * 1000);        // started 1 min ago
  const endsAt   = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // ends in 1 year

  for (const operationType of ['group_creation', 'member_addition', 'deliverable_submission']) {
    await ScheduleWindow.create({
      operationType,
      startsAt,
      endsAt,
      isActive: true,
      createdBy: 'seed-test-student',
      label: `Test window — ${operationType}`,
    });
  }

  // ── Seed SprintConfig (D8) — future deadline for Process 5.4 ────────────
  const deadlineDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  await SprintConfig.create({
    sprintId: 'sprint_1',
    deliverableType: 'proposal',
    deadline: deadlineDate,
    description: 'Test sprint — seeded for local dev',
  });

  // ── Seed test Deliverable records (D4) for GET endpoints ─────────────────
  const deliverableId1 = `DEL-test-${uuidv4().split('-')[0]}`;
  const deliverableId2 = `DEL-test-${uuidv4().split('-')[0]}`;

  await Deliverable.create([
    {
      deliverableId: deliverableId1,
      committeeId,
      groupId,
      studentId: userId,
      type: 'proposal',
      sprintId: 'sprint_1',
      version: 1,
      storageRef: '/uploads/permanent/test-proposal.pdf',
      status: 'accepted',
      submittedAt: new Date(),
      validationHistory: [
        { step: 'format_validation',   passed: true,  checkedAt: new Date(), failureReasons: [] },
        { step: 'deadline_validation', passed: true,  checkedAt: new Date(), failureReasons: [] },
        { step: 'storage',             passed: true,  checkedAt: new Date(), failureReasons: [] },
      ],
    },
    {
      deliverableId: deliverableId2,
      committeeId,
      groupId,
      studentId: userId,
      type: 'proposal',
      sprintId: 'sprint_1',
      version: 2,
      storageRef: '/uploads/permanent/test-proposal-v2.pdf',
      status: 'submitted',
      submittedAt: new Date(),
      validationHistory: [
        { step: 'format_validation',   passed: true,  checkedAt: new Date(), failureReasons: [] },
        { step: 'deadline_validation', passed: true,  checkedAt: new Date(), failureReasons: [] },
      ],
    },
  ]);

  // ── Coordinator JWT for retract endpoint ──────────────────────────────────
  const coordToken = generateAccessToken('coordinator_test', 'coordinator');

  // ── Generate a ready-to-use JWT (1 h) ─────────────────────────────────────
  const token = generateAccessToken(userId, 'student');

  await mongoose.disconnect();

  // ── Print instructions ────────────────────────────────────────────────────
  console.log('\n✅  Test data seeded successfully\n');
  console.log('⚠️   If you were already logged in, log out and log back in.');
  console.log('    The seed creates a new userId each run — old sessions are stale.\n');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`  email    : ${TEST_EMAIL}`);
  console.log(`  password : ${TEST_PASSWORD}`);
  console.log(`  userId   : ${userId}`);
  console.log(`  groupId       : ${groupId}`);
  console.log(`  deliverableId1: ${deliverableId1}  (status: accepted — use this to test retract)`);
  console.log(`  deliverableId2: ${deliverableId2}  (status: submitted)`);
  console.log(`  JWT (student) : ${token}`);
  console.log(`  JWT (coord)   : ${coordToken}`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`
The test student already has an active group (${groupId}).
SprintConfig deadline seeded: sprint_1 / proposal → 30 days from now.

Full Process 5.1 → 5.4 flow via curl:

STEP 1 — Get a validationToken (Process 5.1):

  curl -s -X POST http://localhost:5002/api/v1/deliverables/validate-group \\
    -H "Authorization: Bearer ${token}" \\
    -H "Content-Type: application/json" \\
    -d '{"groupId": "${groupId}"}' | jq .

STEP 2 — Submit a deliverable, get stagingId (Process 5.2):

  echo "%PDF-1.4 test" > /tmp/test.pdf

  curl -s -X POST http://localhost:5002/api/v1/deliverables/submit \\
    -H "Authorization: Bearer ${token}" \\
    -H "Authorization-Validation: <VALIDATION_TOKEN>" \\
    -F "groupId=${groupId}" \\
    -F "deliverableType=proposal" \\
    -F "sprintId=sprint_1" \\
    -F "description=My test proposal" \\
    -F "file=@/tmp/test.pdf;type=application/pdf" | jq .

STEP 3 — Validate format (Process 5.3):

  curl -s -X POST http://localhost:5002/api/v1/deliverables/<STAGING_ID>/validate-format \\
    -H "Authorization: Bearer ${token}" | jq .

STEP 4 — Validate deadline + team requirements (Process 5.4):

  curl -s -X POST http://localhost:5002/api/v1/deliverables/<STAGING_ID>/validate-deadline \\
    -H "Authorization: Bearer ${token}" \\
    -H "Content-Type: application/json" \\
    -d '{"sprintId": "sprint_1"}' | jq .
`);
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
