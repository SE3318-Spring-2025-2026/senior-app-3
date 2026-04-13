/**
 * Seed a test student user + active group + committee + open schedule windows
 * for manual testing of:
 *   POST /api/v1/deliverables/validate-group  (Process 5.1)
 *   POST /api/v1/deliverables/submit          (Process 5.2)
 *
 * Also opens group_creation and member_addition schedule windows so the
 * frontend group creation flow works without a coordinator.
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
  await Committee.deleteOne({ committeeName: 'Test Committee' });
  await ScheduleWindow.deleteMany({ createdBy: 'seed-test-student' });

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
  console.log(`  groupId  : ${groupId}`);
  console.log(`  JWT      : ${token}`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`
The test student already has an active group (${groupId}).
Log in at the frontend, navigate to the group dashboard, and use the
Deliverable Submission form to upload a file.

Or test via curl:

STEP 1 — Get a validationToken (Process 5.1):

  curl -s -X POST http://localhost:5000/api/v1/deliverables/validate-group \\
    -H "Authorization: Bearer ${token}" \\
    -H "Content-Type: application/json" \\
    -d '{"groupId": "${groupId}"}' | jq .

STEP 2 — Submit a deliverable (Process 5.2):

  echo "%PDF-1.4 test" > /tmp/test.pdf

  curl -s -X POST http://localhost:5000/api/v1/deliverables/submit \\
    -H "Authorization: Bearer ${token}" \\
    -H "Authorization-Validation: <paste validationToken here>" \\
    -F "groupId=${groupId}" \\
    -F "deliverableType=proposal" \\
    -F "sprintId=sprint_1" \\
    -F "description=My test proposal" \\
    -F "file=@/tmp/test.pdf;type=application/pdf" | jq .
`);
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
