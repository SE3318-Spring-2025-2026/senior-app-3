const mongoose = require('mongoose');

const committeeSchema = new mongoose.Schema({
  committeeId: { type: String, required: true, unique: true },
  committeeName: { type: String, required: true },
  description: { type: String },
  advisorIds: [{ type: String }],
  juryIds: [{ type: String }],
  status: { type: String, enum: ['draft', 'validated', 'published'], default: 'draft' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

module.exports = mongoose.model('Committee', committeeSchema);