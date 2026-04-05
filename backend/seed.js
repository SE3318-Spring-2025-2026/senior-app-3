/**
 * Seed script — populates StudentIdRegistry with test students from test-students.csv
 * Usage: node seed.js
 * Idempotent: safe to run multiple times.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const StudentIdRegistry = require('./src/models/StudentIdRegistry');
const User = require('./src/models/User');
const { hashPassword } = require('./src/utils/password');

const TEST_PROFESSORS = [
  { email: 'prof.smith@university.edu',   name: 'Dr. Smith',   tempPassword: 'TempPass1!' },
  { email: 'prof.johnson@university.edu', name: 'Dr. Johnson', tempPassword: 'TempPass1!' },
];

const TEST_STUDENTS = [
  { studentId: 'STU-2025-001', name: 'Alice Smith',   email: 'alice@university.edu' },
  { studentId: 'STU-2025-002', name: 'Bob Johnson',   email: 'bob@university.edu' },
  { studentId: 'STU-2025-003', name: 'Charlie Brown', email: 'charlie@university.edu' },
  { studentId: 'STU-2025-004', name: 'Diana Prince',  email: 'diana@university.edu' },
  { studentId: 'STU-2025-005', name: 'Ethan Hunt',    email: 'ethan@university.edu' },
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
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
