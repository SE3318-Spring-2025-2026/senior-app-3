const mongoose = require('mongoose');

/**
 * Committee Schema (D3 Data Store)
 * ========================================================
 * 
 * ARCHITECTURAL PURPOSE:
 * Represents a committee configuration for evaluating group projects.
 * This schema is part of Process 4.0 (Committee Assignment) workflow and
 * manages the complete lifecycle of committee definitions from draft to publication.
 * 
 * DATA FLOW INTEGRATION:
 * - f06: 4.5 → D3 (committee publication flow)
 * - Used by Process 4.1 (draft creation)
 * - Used by Process 4.5 (publication & validation)
 * 
 * PERSISTENCE STRATEGY:
 * - Stored in MongoDB collection: "committees"
 * - Primary Key: committeeId (unique, auto-generated)
 * - Unique Constraint: committeeName (business-level uniqueness)
 * 
 * STATE MACHINE:
 * draft → validated → published
 * Only published committees are visible to Process 4.1
 * 
 * WHY MONGOOSE SCHEMA HERE:
 * Even though we use a raw MongoDB driver in migrations, Mongoose provides
 * type safety, validation hooks, and convenience methods for ORM operations.
 * The migration ensures index creation at the DB layer; this schema ensures
 * application-layer consistency for create/update operations.
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `COM-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      description: 'Primary Key: Globally unique committee identifier',
    },
    committeeName: {
      type: String,
      required: true,
      unique: true,
      index: true,
      minlength: 3,
      maxlength: 100,
      trim: true,
      description: 'Business-level unique name (e.g., "AI/ML Committee", "Web Dev Review Board")',
    },
    description: {
      type: String,
      maxlength: 500,
      default: null,
      description: 'Optional committee scope/mandate description',
    },
    advisorIds: {
      type: [String],
      default: [],
      description: 'Array of advisor user IDs assigned to this committee',
    },
    juryIds: {
      type: [String],
      default: [],
      description: 'Array of jury/reviewer user IDs assigned to this committee',
    },
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
      index: true,
      description: 'State Machine: draft → validated → published. Only published committees are visible to Process 4.1.',
    },
    createdBy: {
      type: String, // coordinatorId
      required: true,
      index: true,
      description: 'Coordinator ID who created this committee draft',
    },
    publishedAt: {
      type: Date,
      default: null,
      description: 'Timestamp when committee transitioned to "published" state',
    },
    publishedBy: {
      type: String, // coordinatorId who published
      default: null,
      description: 'Coordinator ID who published this committee (may differ from createdBy)',
    },
    validatedAt: {
      type: Date,
      default: null,
      description: 'Timestamp when committee transitioned to "validated" state',
    },
    validatedBy: {
      type: String,
      default: null,
      description: 'Coordinator ID (typically admin/supervisor) who validated this committee',
    },
  },
  {
    timestamps: true,
    collection: 'committees',
  }
);

/**
 * QUERY OPTIMIZATION INDEXES
 * ========================================================
 * These compound indexes optimize the most common query patterns:
 */

// Index 1: Retrieve committees created by a specific coordinator, filtered by status
// Use case: Process 4.1 coordinator views their draft committees
// Query: db.committees.find({ createdBy: "coord_123", status: "draft" })
committeeSchema.index({ createdBy: 1, status: 1 });

// Index 2: Retrieve published committees ordered by most recent first
// Use case: Process 4.5 lists committees for assignment (published + sorted)
// Query: db.committees.find({ status: "published" }).sort({ publishedAt: -1 })
committeeSchema.index({ status: 1, publishedAt: -1 });

/**
 * MIDDLEWARE HOOKS
 * ========================================================
 * Pre-save validation to enforce business rules
 */

// Ensure commitment state transitions are valid
committeeSchema.pre('save', async function(next) {
  // If transitioning from draft → published, set publishedAt
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  // If transitioning from draft → validated, set validatedAt
  if (this.isModified('status') && this.status === 'validated' && !this.validatedAt) {
    this.validatedAt = new Date();
  }

  next();
});

module.exports = mongoose.model('Committee', committeeSchema);
