const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const groupSchema = new mongoose.Schema(
  {
    groupId: {
      type: String,
      default: () => `grp_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    professorId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

groupSchema.index({ professorId: 1, status: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
