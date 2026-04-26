'use strict';

/**
 * fix-demo-data.js
 *
 * One-shot, idempotent recovery script for local/demo environments. Run with:
 *
 *   node scripts/fix-demo-data.js
 *
 * What it does (safe to re-run):
 *   1. Inserts missing ScheduleWindow rows for advisor_release / advisor_transfer
 *      / advisor_decision / advisor_sanitization with a wide active range so
 *      coordinators can release/transfer advisors during demos.
 *   2. Attaches a published committee to any Group that has no committeeId, so
 *      students can validate-group / submit deliverables. The first published
 *      committee is reused; if none exists nothing is changed for groups.
 *
 * It does NOT delete or overwrite anything that already exists.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const ScheduleWindow = require('../src/models/ScheduleWindow');
const Group = require('../src/models/Group');
const Committee = require('../src/models/Committee');
const User = require('../src/models/User');

const MONGO_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';

const REQUIRED_WINDOW_TYPES = [
  'group_creation',
  'member_addition',
  'deliverable_submission',
  'advisor_association',
  'advisor_release',
  'advisor_transfer',
  'advisor_decision',
  'advisor_sanitization',
];

async function ensureWindows() {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  let created = 0;
  let alreadyOk = 0;

  for (const operationType of REQUIRED_WINDOW_TYPES) {
    const active = await ScheduleWindow.findOne({
      operationType,
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    });

    if (active) {
      alreadyOk += 1;
      continue;
    }

    await ScheduleWindow.create({
      operationType,
      startsAt,
      endsAt,
      isActive: true,
      createdBy: 'system_recovery',
      label: `Demo recovery window (${operationType})`,
    });
    created += 1;
    console.log(`  [+] inserted ${operationType} window`);
  }

  console.log(
    `Schedule windows: created=${created}, alreadyActive=${alreadyOk}`
  );
}

async function ensurePublishedCommittee() {
  const existing = await Committee.findOne({ status: 'published' });
  if (existing) {
    console.log(`Published committee already exists: ${existing.committeeId}`);
    return existing;
  }

  const professors = await User.find({
    role: 'professor',
    accountStatus: 'active',
  })
    .limit(5)
    .lean();
  const coordinator = await User.findOne({ role: 'coordinator' }).lean();

  if (!coordinator) {
    console.log(
      'No coordinator user exists; cannot create published committee. Run seed first.'
    );
    return null;
  }

  const advisorIds = professors.map((p) => p.userId);
  if (advisorIds.length < 2) {
    console.log(
      `Only ${advisorIds.length} professor(s) found; committee needs >= 2. Skipping.`
    );
    return null;
  }

  const juryIds = advisorIds.slice(0, Math.min(3, advisorIds.length));

  const created = await Committee.create({
    committeeName: `Demo Recovery Committee ${Date.now()}`,
    description: 'Auto-published by fix-demo-data.js for local/demo flows.',
    advisorIds,
    juryIds,
    status: 'published',
    createdBy: coordinator.userId,
    publishedBy: coordinator.userId,
    publishedAt: new Date(),
    validatedAt: new Date(),
    validatedBy: coordinator.userId,
  });
  console.log(
    `Created published committee ${created.committeeId} (advisors=${advisorIds.length}, jury=${juryIds.length}).`
  );
  return created;
}

async function ensureCommitteeAssignments() {
  const groupsMissing = await Group.find({
    $or: [{ committeeId: { $exists: false } }, { committeeId: null }],
  });

  if (groupsMissing.length === 0) {
    console.log('All groups already have a committee.');
    return;
  }

  const committee = await ensurePublishedCommittee();
  if (!committee) {
    console.log(
      `Found ${groupsMissing.length} group(s) without committeeId, but no published committee could be obtained. Skipping.`
    );
    return;
  }

  const result = await Group.updateMany(
    {
      $or: [{ committeeId: { $exists: false } }, { committeeId: null }],
    },
    { $set: { committeeId: committee.committeeId } }
  );
  console.log(
    `Attached committee ${committee.committeeId} to ${result.modifiedCount} group(s).`
  );
}

async function main() {
  console.log(`Connecting to ${MONGO_URI} ...`);
  await mongoose.connect(MONGO_URI);
  try {
    await ensureWindows();
    await ensureCommitteeAssignments();
    console.log('Done.');
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((err) => {
  console.error('fix-demo-data failed:', err);
  process.exit(1);
});
