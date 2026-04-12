const mongoose = require('mongoose');

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * D4 DELIVERABLES SCHEMA (Issue #85 - IDEMPOTENCY FIX)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHAT IS D4?
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * D4 = Deliverables specification for Level 2.4 (Committee Assignment Workflow)
 * Stores committee evaluation deliverables submitted by student groups
 * Three types: D4.1 (Proposal), D4.2 (Statement-of-Work), D4.3 (Demonstration)
 *
 * DATA FLOW:
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * D3 (Committees) → Define jury members → Committee is published → Ready for submissions
 * D4 (Deliverables) ← Student groups submit proposals/SOW/demos → Jury reviews → Updates status
 * D6 (Sprint Records) ← Optional: Link deliverable to sprint for time-tracking
 *
 * ISSUE #85 CONTEXT (Idempotency Bug Fix):
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * BEFORE: Migration 006 had indexes trapped in conditional block
 *         First run: collection + indexes created ✓
 *         Second run: early return, indexes NOT created ✗
 *         Result: unique constraint lost → duplicate deliverableIds possible → data corruption
 *
 * AFTER: Migration 006 split into Phase 1/Phase 2
 *        Phase 1: Collection creation (conditional, only on first run)
 *        Phase 2: Index creation (unconditional, ALWAYS runs)
 *        Result: Unique constraint ALWAYS guaranteed ✓
 *
 * DUAL INDEX STRATEGY (Development + Production):
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Schema-level indexes (HERE): Active in development (no migration runner)
 * Database-level indexes (Migration 006 Phase 2): Active in production (migration guarantees)
 * Together: Indexes present in ALL environments (dev + production + local testing) ✓
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */

const DeliverableSchema = new mongoose.Schema(
  {
    // ═════════════════════════════════════════════════════════════════════════════════════
    // PRIMARY KEY FIELD (D4 Unique Identifier)
    // ═════════════════════════════════════════════════════════════════════════════════════

    deliverableId: {
      type: String,
      unique: true,  // CRITICAL (Issue #85): Prevents duplicate submissions
                     // Schema-level constraint (defense-in-depth Layer 2)
                     // Database-level index (Migration 006 Phase 2 - Layer 3)
      required: true, // Every deliverable must have unique ID
      trim: true,    // Strip whitespace (prevent UUID format issues)
    },

    // ═════════════════════════════════════════════════════════════════════════════════════
    // RELATIONSHIP FIELDS (Cross-Collection References)
    // ═════════════════════════════════════════════════════════════════════════════════════

    committeeId: {
      type: String,
      required: true, // Every deliverable belongs to a committee (D3 reference)
                      // Used for: Find all deliverables for committee X
                      // Index: Migration 006 creates single index on committeeId
                      // Compound: Also in (committeeId, groupId) for committee+group queries
    },

    groupId: {
      type: String,
      required: true, // Every deliverable belongs to a student group (D2 reference)
                      // Used for: Find all deliverables submitted by group Y
                      // Index: Migration 006 creates single index on groupId
                      // Compound: Also in (committeeId, groupId) and (groupId, type) compound indexes
    },

    studentId: {
      type: String,
      required: true, // Attribution: Which student submitted this deliverable (D1 reference)
                      // Used for: Audit trail, submission history per student
                      // Audit: All submissions logged to AuditLog collection
    },

    // ═════════════════════════════════════════════════════════════════════════════════════
    // SPECIFICATION FIELDS (D4.1, D4.2, D4.3 Deliverable Types)
    // ═════════════════════════════════════════════════════════════════════════════════════

    type: {
      type: String,
      enum: ['proposal', 'statement-of-work', 'demonstration'],  // D4 specification types
      required: true, // Type must be specified for committee evaluation
                      // Index: Migration 006 creates single index on type
                      // Compound: Also in (groupId, type) compound index
    },

    submittedAt: {
      type: Date,
      default: () => new Date(),  // Auto-populate timestamp on creation
                                   // Used for: Audit trail, review queue ordering
                                   // Index: Migration 006 creates descending index (newest first)
    },

    storageRef: {
      type: String,
      required: true,              // Cloud storage path (S3, Azure Blob, etc.)
      minlength: 5,                // Reasonable minimum for a storage path
      maxlength: 2048,             // Reasonable maximum for cloud storage URI
    },

    // ═════════════════════════════════════════════════════════════════════════════════════
    // WORKFLOW STATUS FIELDS (D4 State Machine)
    // ═════════════════════════════════════════════════════════════════════════════════════

    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'accepted', 'rejected'],  // D4 workflow states
      default: 'submitted',  // Initial state: awaiting jury review
    },

    feedback: {
      type: String,
      // Optional: Jury feedback for student group (set during review)
      // Usage: Acceptance gaps, rejection reasons, improvement suggestions
    },

    reviewedBy: {
      type: String,
      // Optional: D3 jury member ID who evaluated (set during review)
      // Usage: Audit trail - which jury member evaluated which deliverable
    },

    reviewedAt: {
      type: Date,
      // Optional: Timestamp when jury completed evaluation (set during review)
      // Usage: SLA tracking - how long did evaluation take
    },
  },
  { timestamps: true }  // Auto-add createdAt + updatedAt
);

// ═════════════════════════════════════════════════════════════════════════════════════════
// SCHEMA-LEVEL INDEXES (Development Scenario + Dual Protection)
// 
// These create indexes at Mongoose schema level (active in development).
// Identical indexes created by Migration 006 Phase 2 (active in production).
// Result: Indexes ALWAYS present in all environments ✓
// ═════════════════════════════════════════════════════════════════════════════════════════

// CRITICAL: Unique deliverable ID constraint (prevents duplicate submissions)
DeliverableSchema.index({ deliverableId: 1 });

// Committee scope lookups (all deliverables for committee)
DeliverableSchema.index({ committeeId: 1 });

// Group scope lookups (all deliverables submitted by group)
DeliverableSchema.index({ groupId: 1 });

// Type filtering (all deliverables of specific type)
DeliverableSchema.index({ type: 1 });

// Compound: Committee + Group (all deliverables for committee in group)
DeliverableSchema.index({ committeeId: 1, groupId: 1 });

// Compound: Group + Type (group's specific submission type)
DeliverableSchema.index({ groupId: 1, type: 1 });

// Chronological: Most recent submissions first (for review queue UI)
DeliverableSchema.index({ submittedAt: -1 });

module.exports = mongoose.model('Deliverable', DeliverableSchema);
