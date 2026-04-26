require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const { hashPassword } = require('../src/utils/password');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';
  await mongoose.connect(uri);

  const hashedPassword = await hashPassword('Test123!');
  const users = [
    { email: 'test.coordinator@example.com', role: 'coordinator' },
    { email: 'test.student@example.com', role: 'student' },
    { email: 'test.advisor@example.com', role: 'professor' }
  ];

  for (const user of users) {
    await User.findOneAndUpdate(
      { email: user.email },
      {
        $set: {
          email: user.email,
          hashedPassword,
          role: user.role,
          accountStatus: 'active',
          emailVerified: true,
          loginAttempts: 0,
          lockedUntil: null,
          requiresPasswordChange: false
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const testStudentGroupId = process.env.TEST_STUDENT_GROUP_ID;
  if (testStudentGroupId) {
    const student = await User.findOne({ email: 'test.student@example.com' }).select('userId').lean();
    if (student?.userId) {
      await Group.findOneAndUpdate(
        { groupId: testStudentGroupId },
        {
          $set: {
            'members.$[member].status': 'accepted',
            'members.$[member].joinedAt': new Date()
          }
        },
        {
          arrayFilters: [{ 'member.userId': student.userId }],
        }
      );

      await Group.findOneAndUpdate(
        {
          groupId: testStudentGroupId,
          members: { $not: { $elemMatch: { userId: student.userId } } }
        },
        {
          $push: {
            members: {
              userId: student.userId,
              role: 'member',
              status: 'accepted',
              joinedAt: new Date()
            }
          }
        }
      );
    }
  }

  console.log('Test users ready');
}

run()
  .catch((error) => {
    console.error('Failed to create test users:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
