'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Models
const User              = require('../src/models/User');
const Group             = require('../src/models/Group');
const Committee         = require('../src/models/Committee');
const ScheduleWindow    = require('../src/models/ScheduleWindow');
const AdvisorRequest    = require('../src/models/AdvisorRequest');
const AdvisorAssignment = require('../src/models/AdvisorAssignment');
const AuditLog          = require('../src/models/AuditLog');
const Deliverable       = require('../src/models/Deliverable');
const SprintRecord      = require('../src/models/SprintRecord');
const SprintConfig      = require('../src/models/SprintConfig');

// Utilities
const { hashPassword }        = require('../src/utils/password');
const { generateAccessToken } = require('../src/utils/jwt');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';

// Test user credentials
const TEST_USERS = {
  student1: { email: 'alice.student@example.edu.tr', password: 'Test@1234' },
  student2: { email: 'bob.student@example.edu.tr', password: 'Test@1234' },
  student3: { email: 'charlie.student@example.edu.tr', password: 'Test@1234' },
  professor: { email: 'prof.advisor@example.edu.tr', password: 'Test@1234' },
  coordinator: { email: 'coord.admin@example.edu.tr', password: 'Test@1234' },
  admin: { email: 'system.admin@example.edu.tr', password: 'Test@1234' },
};

// Helper to generate IDs
const generateId = (prefix) => `${prefix}_${uuidv4().split('-')[0]}`;

/**
 * Create test users
 */
async function seedUsers() {
  console.log('🌱 Seeding users...');

  const users = {};
  for (const [role, creds] of Object.entries(TEST_USERS)) {
    const userRole = role.includes('student') ? 'student'
      : role.includes('professor') ? 'professor'
      : role.includes('coordinator') ? 'coordinator'
      : 'admin';

    const user = await User.create({
      userId: generateId('usr'),
      email: creds.email,
      hashedPassword: await hashPassword(creds.password),
      role: userRole,
      emailVerified: true,
      accountStatus: 'active',
    });

    users[role] = user;
    console.log(`  ✓ Created ${userRole}: ${creds.email}`);
  }

  return users;
}

/**
 * Create test committees
 */
async function seedCommittees(professorId) {
  console.log('🌱 Seeding committees...');

  const committees = [];
  for (let i = 1; i <= 2; i++) {
    const committee = await Committee.create({
      committeeId: generateId('com'),
      committeeName: `Test Committee ${i}`,
      description: `Test committee for general seeding - Committee ${i}`,
      advisorIds: [professorId],
      juryIds: [professorId],
      status: 'published',
      createdBy: 'seed-test-general',
      publishedAt: new Date(),
      publishedBy: 'seed-test-general',
    });

    committees.push(committee);
    console.log(`  ✓ Created committee: ${committee.committeeName}`);
  }

  return committees;
}

/**
 * Create test groups with members
 */
async function seedGroups(users, committees) {
  console.log('🌱 Seeding groups...');

  const groups = [];

  // Group 1: Alice as leader, Bob as member
  const group1 = await Group.create({
    groupId: generateId('grp'),
    groupName: 'Project Alpha Team',
    leaderId: users.student1.userId,
    status: 'active',
    committeeId: committees[0].committeeId,
    createdBy: 'seed-test-general',
    members: [
      { userId: users.student1.userId, role: 'leader', status: 'accepted' },
      { userId: users.student2.userId, role: 'member', status: 'accepted' },
    ],
  });
  groups.push(group1);
  console.log(`  ✓ Created group: ${group1.groupName}`);

  // Group 2: Charlie as leader
  const group2 = await Group.create({
    groupId: generateId('grp'),
    groupName: 'Project Beta Team',
    leaderId: users.student3.userId,
    status: 'active',
    committeeId: committees[1].committeeId,
    createdBy: 'seed-test-general',
    members: [
      { userId: users.student3.userId, role: 'leader', status: 'accepted' },
    ],
  });
  groups.push(group2);
  console.log(`  ✓ Created group: ${group2.groupName}`);

  return groups;
}

/**
 * Create schedule windows
 */
async function seedScheduleWindows() {
  console.log('🌱 Seeding schedule windows...');

  const now = new Date();
  const windows = [];

  const windowTypes = [
    { type: 'group_creation', dayOffset: -10 },
    { type: 'member_addition', dayOffset: -5 },
    { type: 'deliverable_submission', dayOffset: 0 },
    { type: 'advisor_association', dayOffset: 5 },
  ];

  for (const { type, dayOffset } of windowTypes) {
    const window = await ScheduleWindow.create({
      operationType: type,
      startsAt: new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000 - 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + (dayOffset + 30) * 24 * 60 * 60 * 1000),
      isActive: true,
      createdBy: 'seed-test-general',
      label: `Test window — ${type}`,
    });

    windows.push(window);
    console.log(`  ✓ Created schedule window: ${type}`);
  }

  return windows;
}

/**
 * Create advisor requests and assignments
 */
async function seedAdvisorSetup(groups, users) {
  console.log('🌱 Seeding advisor requests & assignments...');

  const request = await AdvisorRequest.create({
    requestId: generateId('arq'),
    groupId: groups[0].groupId,
    professorId: users.professor.userId,
    requesterId: groups[0].leaderId,
    status: 'approved',
    message: 'Request to assign as advisor for our project',
    processedAt: new Date(),
  });
  console.log(`  ✓ Created advisor request for ${groups[0].groupName}`);

  const assignment = await AdvisorAssignment.create({
    assignmentId: generateId('asn'),
    groupRef: groups[0]._id,
    groupId: groups[0].groupId,
    advisorId: users.professor.userId,
    status: 'active',
    assignedAt: new Date(),
    updatedBy: 'seed-test-general',
  });
  console.log(`  ✓ Created advisor assignment for ${groups[0].groupName}`);

  return { request, assignment };
}

/**
 * Create audit logs for various actions
 */
async function seedAuditLogs(users) {
  console.log('🌱 Seeding audit logs...');

  const actions = [
    { action: 'ACCOUNT_CREATED', userId: users.student1.userId, description: 'Student 1 account created' },
    { action: 'LOGIN_SUCCESS', userId: users.student1.userId, description: 'Student 1 login' },
    { action: 'ACCOUNT_CREATED', userId: users.professor.userId, description: 'Professor account created' },
    { action: 'GITHUB_OAUTH_LINKED', userId: users.student1.userId, description: 'GitHub OAuth linked' },
    { action: 'GROUP_CREATED', userId: users.student1.userId, description: 'Group formed' },
    { action: 'MEMBER_ADDED', userId: users.student1.userId, description: 'Team member added' },
  ];

  const logs = [];
  for (const { action, userId, description } of actions) {
    const log = await AuditLog.create({
      auditId: generateId('aud'),
      action,
      userId,
      description,
      createdAt: new Date(),
    });
    logs.push(log);
  }

  console.log(`  ✓ Created ${logs.length} audit log entries`);
  return logs;
}

/**
 * Create sprint records
 */
async function seedSprintRecords(groups, committees) {
  console.log('🌱 Seeding sprint records...');

  const sprints = [];

  for (let i = 1; i <= 2; i++) {
    for (let j = 1; j <= 2; j++) {
      const sprint = await SprintRecord.create({
        sprintRecordId: generateId('spr'),
        sprintId: `sprint_${i}_${j}`,
        groupId: groups[i - 1].groupId,
        committeeId: committees[i - 1].committeeId,
        status: j === 1 ? 'in_progress' : 'pending',
        deliverableRefs: [],
      });

      sprints.push(sprint);
      console.log(`  ✓ Created sprint: ${groups[i - 1].groupName} - ${sprint.sprintId}`);
    }
  }

  return sprints;
}

/**
 * Create sprint configs (deadlines) for each sprint + deliverable type combination.
 * Required by Process 5.4 (validate-deadline).
 */
async function seedSprintConfigs(sprints) {
  console.log('🌱 Seeding sprint configs (deadlines)...');

  const configs = [];
  const deliverableTypes = [
    'proposal',
    'statement_of_work',
    'demo',
    'interim_report',
    'final_report',
  ];

  const uniqueSprintIds = [...new Set(sprints.map((s) => s.sprintId))];

  for (const sprintId of uniqueSprintIds) {
    for (const deliverableType of deliverableTypes) {
      const config = await SprintConfig.create({
        sprintId,
        deliverableType,
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 gün sonra
        description: `Test deadline — ${sprintId} / ${deliverableType}`,
      });
      configs.push(config);
      console.log(`  ✓ Created sprint config: ${sprintId} / ${deliverableType}`);
    }
  }

  return configs;
}

/**
 * Create sample deliverables — aligned with current Deliverable schema (D4).
 */
async function seedDeliverables(groups, users, sprints) {
  console.log('🌱 Seeding deliverables...');

  const deliverables = [];
  const types = ['proposal', 'statement_of_work', 'demo'];

  for (let i = 0; i < groups.length; i++) {
    const group  = groups[i];
    const leader = i === 0 ? users.student1 : users.student3;
    const sprint = sprints.find((s) => s.groupId === group.groupId) ?? sprints[i * 2];
    const type   = types[i % types.length];

    const deliverable = await Deliverable.create({
      deliverableId:   generateId('del'),
      groupId:         group.groupId,
      committeeId:     group.committeeId,
      deliverableType: type,
      sprintId:        sprint?.sprintId ?? null,
      submittedBy:     leader.userId,
      description:     `Sample ${type} deliverable for ${group.groupName}`,
      filePath:        `s3://deliverables/${group.groupId}/${type}_v1.pdf`,
      fileSize:        204800,
      fileHash:        uuidv4().replace(/-/g, ''),
      format:          'pdf',
      status:          'accepted',
      version:         1,
      submittedAt:     new Date(),
    });

    deliverables.push(deliverable);
    console.log(`  ✓ Created deliverable: ${group.groupName} - ${type}`);
  }

  return deliverables;
}

/**
 * Main seeding function
 */
async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('📦 Connected to MongoDB\n');

    // Clean up previous test data
    console.log('🧹 Cleaning up previous test data...');
    const testEmails = Object.values(TEST_USERS).map(u => u.email);

    await User.deleteMany({ email: { $in: testEmails } });
    await Group.deleteMany({ groupName: { $in: ['Project Alpha Team', 'Project Beta Team'] } });
    await Committee.deleteMany({ createdBy: 'seed-test-general' });
    await ScheduleWindow.deleteMany({ createdBy: 'seed-test-general' });
    await AdvisorRequest.deleteMany({ requesterId: { $regex: /^usr_/ } });
    await AdvisorAssignment.deleteMany({ assignedBy: 'seed-test-general' });
    await AuditLog.deleteMany({ auditId: { $regex: /^aud_/ } });
    await SprintRecord.deleteMany({ sprintRecordId: { $regex: /^spr_/ } });
    await Deliverable.deleteMany({ deliverableId: { $regex: /^del_/ } });
    await SprintConfig.deleteMany({ sprintId: { $regex: /^sprint_/ } });

    console.log('  ✓ Cleaned up old test data\n');

    // Seed data
    const users = await seedUsers();
    console.log();

    const committees = await seedCommittees(users.professor.userId);
    console.log();

    const groups = await seedGroups(users, committees);
    console.log();

    await seedScheduleWindows();
    console.log();

    await seedAdvisorSetup(groups, users);
    console.log();

    await seedAuditLogs(users);
    console.log();

    const sprints = await seedSprintRecords(groups, committees);
    console.log();

    const sprintConfigs = await seedSprintConfigs(sprints);
    console.log();

    const deliverables = await seedDeliverables(groups, users, sprints);
    console.log();

    // Create a Review for each deliverable so comment endpoints work immediately
    const Review = require('../src/models/Review');
    const reviews = [];
    for (const d of deliverables) {
      const r = await Review.create({
        deliverableId: d.deliverableId,
        groupId: d.groupId,
        status: 'pending',
        assignedMembers: [],
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      reviews.push(r);
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const sep = '─'.repeat(72);

    console.log(`\n${'═'.repeat(72)}`);
    console.log('  SEED SUMMARY');
    console.log(`${'═'.repeat(72)}\n`);

    // Users
    console.log('👤 USERS');
    console.log(sep);
    for (const [role, user] of Object.entries(users)) {
      const creds = TEST_USERS[role];
      console.log(`  ${role.toUpperCase().padEnd(12)} | userId: ${user.userId.padEnd(16)} | email: ${creds.email}  pw: ${creds.password}`);
    }

    // Groups
    console.log(`\n🏢 GROUPS`);
    console.log(sep);
    for (const g of groups) {
      console.log(`  ${g.groupName.padEnd(22)} | groupId: ${g.groupId}`);
    }

    // Deliverables + Reviews
    console.log(`\n📄 DELIVERABLES & REVIEWS`);
    console.log(sep);
    for (let i = 0; i < deliverables.length; i++) {
      const d = deliverables[i];
      const r = reviews[i];
      const g = groups.find(g => g.groupId === d.groupId);
      console.log(`  ${(g?.groupName ?? d.groupId).padEnd(22)} | deliverableId: ${d.deliverableId.padEnd(16)} | type: ${d.deliverableType.padEnd(18)} | reviewId: ${r.reviewId}`);
    }

    // Sprints
    console.log(`\n🏃 SPRINTS`);
    console.log(sep);
    for (const s of sprints) {
      const g = groups.find(g => g.groupId === s.groupId);
      console.log(`  ${(g?.groupName ?? s.groupId).padEnd(22)} | sprintRecordId: ${s.sprintRecordId.padEnd(16)} | sprintId: ${s.sprintId}`);
    }

    // Sprint Configs
    console.log(`\n⏰ SPRINT CONFIGS (DEADLINES)`);
    console.log(sep);
    for (const c of sprintConfigs) {
      console.log(`  ${c.sprintId.padEnd(16)} | type: ${c.deliverableType.padEnd(20)} | deadline: ${c.deadline.toISOString()}`);
    }

    // Tokens
    console.log(`\n🔐 JWT TOKENS  (valid ~15 min — re-run to refresh)`);
    console.log(sep);
    for (const [role, user] of Object.entries(users)) {
      const token = generateAccessToken(user.userId, user.role);
      console.log(`  ${role.toUpperCase().padEnd(12)} | ${token}`);
    }

    console.log(`\n${'═'.repeat(72)}`);
    console.log('✨ Seeding complete!');
    console.log(`${'═'.repeat(72)}\n`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  }
}

run();