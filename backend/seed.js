/**
 * Seed script — populates StudentIdRegistry with test students from test-students.csv
 * Usage: node seed.js
 * Idempotent: safe to run multiple times.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const StudentIdRegistry = require('./src/models/StudentIdRegistry');
const User = require('./src/models/User');
const Group = require('./src/models/Group');
const { hashPassword } = require('./src/utils/password');
const { forwardToMemberRequestPipeline } = require('./src/services/groupService');

const TEST_PROFESSORS = [
  { email: 'prof.smith@university.edu', name: 'Dr. Smith', tempPassword: 'TempPass1!' },
  { email: 'prof.johnson@university.edu', name: 'Dr. Johnson', tempPassword: 'TempPass1!' },
];

const TEST_ADMINS = [
  { email: 'admin@university.edu', name: 'Test Admin', password: 'AdminPass1!' },
];

const TEST_COORDINATORS = [
  { email: 'coordinator@university.edu', name: 'Test Coordinator', password: 'CoordPass1!' },
];

const TEST_STUDENTS = [
  { studentId: 'STU-2025-001', name: 'Alice Smith', email: 'alice@university.edu' },
  { studentId: 'STU-2025-002', name: 'Bob Johnson', email: 'bob@university.edu' },
  { studentId: 'STU-2025-003', name: 'Charlie Brown', email: 'charlie@university.edu' },
  { studentId: 'STU-2025-004', name: 'Diana Prince', email: 'diana@university.edu' },
  { studentId: 'STU-2025-005', name: 'Ethan Hunt', email: 'ethan@university.edu' },
];

const TEST_STUDENT_USERS = [
  { email: 'charlie@university.edu', name: 'Charlie Brown', tempPassword: 'TempPass1!' },
  { email: 'diana@university.edu', name: 'Diana Prince', tempPassword: 'TempPass1!' },
  { email: 'ethan@university.edu', name: 'Ethan Hunt', tempPassword: 'TempPass1!' },
];

const TEST_GROUPS = [
  {
    groupName: 'Alpha Team',
    leaderEmail: 'diana@university.edu',
  },
  {
    groupName: 'Beta Squad',
    leaderEmail: 'ethan@university.edu',
  },
  {
    groupName: 'Gamma Force',
    leaderEmail: 'charlie@university.edu',
  },
];

async function seed() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  let inserted = 0;
  let skipped = 0;

  for (const student of TEST_STUDENTS) {
    const exists = await StudentIdRegistry.findOne({ studentId: student.studentId });
    if (exists) {
      console.log(`  skip  ${student.studentId} (already exists)`);
      skipped++;
    } else {
      await StudentIdRegistry.create({
        studentId: student.studentId,
        name: student.name,
        email: student.email,
        status: 'valid',
        uploadBatchId: 'seed',
      });
      console.log(`  added ${student.studentId} — ${student.email}`);
      inserted++;
    }
  }

  console.log(`\nDone (students): ${inserted} inserted, ${skipped} skipped.`);

  // ── Professors ────────────────────────────────────────────────────────────
  console.log('\nSeeding professors...');
  let profInserted = 0;
  let profSkipped = 0;

  for (const prof of TEST_PROFESSORS) {
    const exists = await User.findOne({ email: prof.email });
    if (exists) {
      console.log(`  skip  ${prof.email} (already exists)`);
      profSkipped++;
    } else {
      const hashedPassword = await hashPassword(prof.tempPassword);
      await User.create({
        email: prof.email,
        hashedPassword,
        role: 'professor',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: true,
      });
      console.log(`  added ${prof.email} — temp password: ${prof.tempPassword}`);
      profInserted++;
    }
  }

  console.log(`Done (professors): ${profInserted} inserted, ${profSkipped} skipped.`);

  // ── Admins ────────────────────────────────────────────────────────────────
  console.log('\nSeeding admins...');
  let adminInserted = 0;
  let adminSkipped = 0;

  for (const admin of TEST_ADMINS) {
    const exists = await User.findOne({ email: admin.email });
    if (exists) {
      console.log(`  skip  ${admin.email} (already exists)`);
      adminSkipped++;
    } else {
      const hashedPassword = await hashPassword(admin.password);
      await User.create({
        email: admin.email,
        hashedPassword,
        role: 'admin',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });
      console.log(`  added ${admin.email} — password: ${admin.password}`);
      adminInserted++;
    }
  }

  console.log(`Done (admins): ${adminInserted} inserted, ${adminSkipped} skipped.`);

  // ── Coordinators ──────────────────────────────────────────────────────────
  console.log('\nSeeding coordinators...');
  let coordInserted = 0;
  let coordSkipped = 0;

  for (const coord of TEST_COORDINATORS) {
    const exists = await User.findOne({ email: coord.email });
    if (exists) {
      console.log(`  skip  ${coord.email} (already exists)`);
      coordSkipped++;
    } else {
      const hashedPassword = await hashPassword(coord.password);
      await User.create({
        email: coord.email,
        hashedPassword,
        role: 'coordinator',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });
      console.log(`  added ${coord.email} — password: ${coord.password}`);
      coordInserted++;
    }
  }

  console.log(`Done (coordinators): ${coordInserted} inserted, ${coordSkipped} skipped.`);

  // ── Student Users ─────────────────────────────────────────────────────────
  console.log('\nSeeding student users...');
  let studentUserInserted = 0;
  let studentUserSkipped = 0;

  for (const student of TEST_STUDENT_USERS) {
    const exists = await User.findOne({ email: student.email });
    if (exists) {
      if (exists.requiresPasswordChange) {
        await User.updateOne({ email: student.email }, { $set: { requiresPasswordChange: false } });
        console.log(`  updated ${student.email} — cleared requiresPasswordChange`);
      } else {
        console.log(`  skip  ${student.email} (already exists)`);
      }
      studentUserSkipped++;
    } else {
      const hashedPassword = await hashPassword(student.tempPassword);
      await User.create({
        email: student.email,
        hashedPassword,
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });
      console.log(`  added ${student.email} — temp password: ${student.tempPassword}`);
      studentUserInserted++;
    }
  }

  console.log(`Done (student users): ${studentUserInserted} inserted, ${studentUserSkipped} skipped.`);

  // ── Groups ────────────────────────────────────────────────────────────────
  console.log('\nSeeding groups...');
  let groupInserted = 0;
  let groupSkipped = 0;

  for (const groupData of TEST_GROUPS) {
    const exists = await Group.findOne({ groupName: groupData.groupName });
    if (exists) {
      console.log(`  skip  "${groupData.groupName}" (already exists)`);
      groupSkipped++;
      continue;
    }

    const leader = await User.findOne({ email: groupData.leaderEmail });
    if (!leader) {
      console.log(`  skip  "${groupData.groupName}" — leader ${groupData.leaderEmail} not found`);
      groupSkipped++;
      continue;
    }

    const group = new Group({
      groupName: groupData.groupName,
      leaderId: leader.userId,
      status: 'pending_validation',
      members: [
        {
          userId: leader.userId,
          role: 'leader',
          status: 'accepted',
          joinedAt: new Date(),
        },
      ],
    });

    await group.save();

    try {
      await forwardToMemberRequestPipeline(group);
    } catch (err) {
      console.warn(`  warn  pipeline forward failed for "${groupData.groupName}":`, err.message);
    }

    console.log(`  added "${groupData.groupName}" — leader: ${groupData.leaderEmail}`);
    groupInserted++;
  }

  console.log(`Done (groups): ${groupInserted} inserted, ${groupSkipped} skipped.`);

  // ── Save ────────────────────────────────────────────────────────────────

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
