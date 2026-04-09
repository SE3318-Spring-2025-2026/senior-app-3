const mongoose = require('mongoose');

module.exports = {
  up: async () => {
    // Ensure committee collection exists with indexes
    const Committee = mongoose.model('Committee', new mongoose.Schema({
      committeeId: { type: String, required: true, unique: true },
      committeeName: { type: String, required: true },
      description: { type: String },
      advisorIds: [{ type: String }],
      juryIds: [{ type: String }],
      status: { type: String, enum: ['draft', 'validated', 'published'], default: 'draft' },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date }
    }));

    // Create indexes if needed
    await Committee.ensureIndexes();
  },

  down: async () => {
    // Drop committee collection
    await mongoose.connection.db.dropCollection('committees');
  }
};