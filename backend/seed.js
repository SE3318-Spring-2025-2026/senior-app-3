require('dotenv').config();
const mongoose = require('mongoose');
const { faker } = require('@faker-js/faker');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';

const advisorTitles = ['Prof. Dr.', 'Doc. Dr.', 'Dr. Ogr. Uyesi', 'Ars. Gor. Dr.'];
const departments = [
  'Bilgisayar Muhendisligi',
  'Yazilim Muhendisligi',
  'Elektrik Elektronik Muhendisligi',
  'Endustri Muhendisligi',
  'Yapay Zeka Muhendisligi',
];

const studentSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    studentNumber: { type: String, required: true, unique: true, trim: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  },
  { timestamps: true }
);

const advisorSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    department: { type: String, required: true, trim: true },
    academicTitle: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const committeeMemberSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    department: { type: String, required: true, trim: true },
    academicTitle: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const groupSchema = new mongoose.Schema(
  {
    groupId: {
      type: String,
      unique: true,
      default: () => `grp_${new mongoose.Types.ObjectId().toHexString()}`,
    },
    groupName: { type: String, required: true, unique: true, trim: true },
    projectTitle: { type: String, required: true, trim: true },
    advisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Advisor', required: true },
    committeeMembers: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'CommitteeMember', required: true },
    ],
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true }],
  },
  { timestamps: true }
);

const Student = mongoose.models.Student || mongoose.model('Student', studentSchema);
const Advisor = mongoose.models.Advisor || mongoose.model('Advisor', advisorSchema);
const CommitteeMember =
  mongoose.models.CommitteeMember || mongoose.model('CommitteeMember', committeeMemberSchema);
const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);

const pickUnique = (items, count) => {
  const pool = [...items];
  const result = [];

  while (result.length < count && pool.length > 0) {
    const randomIndex = faker.number.int({ min: 0, max: pool.length - 1 });
    const [picked] = pool.splice(randomIndex, 1);
    result.push(picked);
  }

  return result;
};

const createPerson = (index, roleTag) => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const safeEmail = `${firstName}.${lastName}.${roleTag}.${index}`.toLowerCase().replace(/\s+/g, '');

  return {
    firstName,
    lastName,
    email: `${safeEmail}@example.edu.tr`,
    department: faker.helpers.arrayElement(departments),
    academicTitle: faker.helpers.arrayElement(advisorTitles),
  };
};

const createStudent = (index) => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const safeEmail = `${firstName}.${lastName}.student.${index}`.toLowerCase().replace(/\s+/g, '');

  return {
    firstName,
    lastName,
    email: `${safeEmail}@example.edu.tr`,
    studentNumber: `20${faker.number.int({ min: 20, max: 25 })}${String(index + 1).padStart(4, '0')}`,
  };
};

const buildProjectTitle = () =>
  `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} Icin ${faker.company.catchPhraseNoun()} Platformu`;

const runSeed = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB baglantisi kuruldu.');

    await Promise.all([
      Student.deleteMany({}),
      Advisor.deleteMany({}),
      CommitteeMember.deleteMany({}),
      Group.deleteMany({}),
    ]);
    console.log('Eski veriler temizlendi (students, advisors, committeeMembers, groups).');

    const advisors = await Advisor.insertMany(
      Array.from({ length: 5 }).map((_, i) => createPerson(i + 1, 'advisor'))
    );

    const committeeMembers = await CommitteeMember.insertMany(
      Array.from({ length: 10 }).map((_, i) => createPerson(i + 1, 'committee'))
    );

    const students = await Student.insertMany(Array.from({ length: 40 }).map((_, i) => createStudent(i)));

    const groups = [];
    for (let i = 0; i < 10; i += 1) {
      const advisor = faker.helpers.arrayElement(advisors);
      const committeeSelection = pickUnique(committeeMembers, 3);
      const groupStudents = students.slice(i * 4, i * 4 + 4);

      const group = await Group.create({
        groupName: `Grup-${String(i + 1).padStart(2, '0')}`,
        projectTitle: buildProjectTitle(),
        advisor: advisor._id,
        committeeMembers: committeeSelection.map((member) => member._id),
        students: groupStudents.map((student) => student._id),
      });

      await Student.updateMany(
        { _id: { $in: groupStudents.map((student) => student._id) } },
        { $set: { group: group._id } }
      );

      groups.push(group);
    }

    console.log('Seed islemi basariyla tamamlandi:');
    console.log(`- Advisor sayisi: ${advisors.length}`);
    console.log(`- Committee Member sayisi: ${committeeMembers.length}`);
    console.log(`- Group sayisi: ${groups.length}`);
    console.log(`- Student sayisi: ${students.length}`);
  } catch (error) {
    console.error('Seed hatasi:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

runSeed();
