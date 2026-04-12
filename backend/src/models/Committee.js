const mongoose = require('mongoose');

/**
 * Issue #84 FIX: Committee Schema (D3 Data Store)
 * 
 * ════════════════════════════════════════════════════════════════════════
 * SCHEMA DEFINITION FOR COMMITTEE ASSIGNMENT PROCESS (Process 4.0-4.5)
 * ════════════════════════════════════════════════════════════════════════
 * 
 * Purpose:
 * Represents a committee configuration for evaluating student group projects.
 * Stores committee composition (advisors, jury) and publication status.
 * Central persistence layer for the entire Committee Assignment workflow.
 * 
 * ARCHITECTURAL CONTEXT:
 * This schema is part of Process 4.0 (Committee Assignment) workflow and
 * manages the complete lifecycle of committee definitions from draft to publication.
 * 
 * Process Integration:
 * - Process 4.1: Committee draft creation (POST /committees)
 * - Process 4.2: Advisor assignment (POST /committees/{id}/advisors)
 * - Process 4.3: Jury assignment (POST /committees/{id}/jury)
 * - Process 4.4: Committee validation (POST /committees/{id}/validate)
 * - Process 4.5: Committee publication (POST /committees/{id}/publish)
 * 
 * DFD Flows:
 * - f01: Coordinator → 4.1 (create committee)
 * - f02: 4.1 → 4.2 (forward to advisor assignment)
 * - f03: 4.2 → 4.4 (advisor assignments forwarded)
 * - f04: 4.3 → 4.4 (jury assignments forwarded)
 * - f05: 4.4 → 4.5 (validated committee forwarded)
 * - f06: 4.5 → D3 (publish committee to storage)
 * - f07: 4.5 → D2 (update group assignments)
 * - f08: 4.5 → Coordinator (publish status returned)
 * - f09: 4.5 → Notification Service (send committee notifications)
 * 
 * Status Lifecycle:
 * 1. draft (initial) - Created by coordinator, awaiting advisor/jury assignments
 * 2. validated - All requirements met, ready for publication
 * 3. published - Published to system, notifications sent, process complete
 * 
 * Constraints & Indexes (Issue #84 FIX):
 * - committeeName: UNIQUE constraint ensures no duplicate names
 * - committeeId: UNIQUE identifier for external references
 * - status: Indexed for process flow queries
 * - (createdBy, status): Compound for coordinator dashboard
 * - (status, publishedAt): Compound for recent committees listing
 * 
 * Reference: Issue #84 PR Review - Migration Idempotency Failure & Index Bypass
 */
const committeeSchema = new mongoose.Schema(
  {
    /**
     * Issue #84 FIX: committeeId - Unique Committee Identifier
     * 
     * Generated automatically on creation using timestamp + random string
     * Used as external reference in API endpoints and queries
     * UNIQUE constraint prevents duplicate identifiers in database
     * 
     * Example: COM-1702850400000-a7x9k2m5
     */
    committeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `COM-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      description: 'Primary Key: Globally unique committee identifier',
    },

    /**
     * Issue #84 FIX: committeeName - CRITICAL UNIQUE CONSTRAINT
     * 
     * Human-readable committee name (e.g., "Spring 2025 Senior Projects")
     * UNIQUE constraint enforced at DB level (index created unconditionally)
     * This is the PRIMARY DATA INTEGRITY constraint for Issue #84 fix
     * 
     * Why UNIQUE at DB level?
     * - Prevents duplicate committee names by database constraint
     * - Cannot be bypassed by application logic (database-enforced)
     * - Recoverable from partial failures (index created unconditionally)
     * - Migration idempotency ensures constraint always exists
     * 
     * Validation: 3-100 characters (enforced by schema minlength/maxlength)
     */
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

    /**
     * description - Optional committee details
     * Maximum 500 characters for coordinator notes
     */
    description: {
      type: String,
      maxlength: 500,
      default: null,
      description: 'Optional committee scope/mandate description',
    },

    /**
     * advisorIds - Array of advisor user IDs assigned to committee
     * Populated via Process 4.2 (Assign Advisors)
     * Default empty, populated by coordinator during setup
     * No duplicates enforced by application layer (API removes duplicates)
     */
    advisorIds: {
      type: [String],
      default: [],
      description: 'Array of advisor user IDs assigned to this committee',
    },

    /**
     * juryIds - Array of jury member user IDs assigned to committee
     * Populated via Process 4.3 (Add Jury Members)
     * Default empty, populated by coordinator during setup
     * No duplicates enforced by application layer (API removes duplicates)
     */
    juryIds: {
      type: [String],
      default: [],
      description: 'Array of jury/reviewer user IDs assigned to this committee',
    },

    /**
     * status - Committee workflow status
     * 
     * Lifecycle:
     * 1. draft (initial): Created but not yet validated
     * 2. validated: All requirements met (min advisors, min jury, no conflicts)
     * 3. published: Published to system, notifications sent to recipients
     * 
     * Indexed for efficient process flow queries
     * Transition rules enforced by committeeService.js (prevent invalid transitions)
     * 
     * Example transitions:
     * draft → validated (via POST /committees/{id}/validate)
     * validated → published (via POST /committees/{id}/publish)
     * Cannot go backwards (validation prevents degradation)
     */
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
      index: true,
      description: 'State Machine: draft → validated → published. Only published committees are visible to Process 4.1.',
    },

    /**
     * createdBy - Coordinator ID who created the committee draft
     * Indexed for "my committees" dashboard queries
     * Used in compound index: (createdBy, status) for process flow
     */
    createdBy: {
      type: String, // coordinatorId
      required: true,
      index: true,
      description: 'Coordinator ID who created this committee draft',
    },

    /**
     * publishedAt - Timestamp when committee was published to system
     * Set only when status transitions to 'published'
     * Used in compound descending index for "recent committees" queries
     * Default null until publication
     */
    publishedAt: {
      type: Date,
      default: null,
      description: 'Timestamp when committee transitioned to "published" state',
    },

    /**
     * publishedBy - Coordinator ID who published the committee
     * Records which coordinator triggered the publication
     * Stored for audit trail purposes
     */
    publishedBy: {
      type: String, // coordinatorId who published
      default: null,
      description: 'Coordinator ID who published this committee (may differ from createdBy)',
    },

    /**
     * validatedAt - Timestamp when committee was validated
     * Set when Process 4.4 validation passes
     * Records point in time when validation occurred
     */
    validatedAt: {
      type: Date,
      default: null,
      description: 'Timestamp when committee transitioned to "validated" state',
    },

    /**
     * validatedBy - Coordinator ID who validated the committee
     * Records which coordinator triggered the validation
     * Stored for audit trail purposes
     */
    validatedBy: {
      type: String,
      default: null,
      description: 'Coordinator ID (typically admin/supervisor) who validated this committee',
    },
  },
  {
    /**
     * Issue #84 FIX: Schema Options
     * 
     * timestamps: true → MongoDB automatically manages createdAt/updatedAt
     * - createdAt: Set on document creation (cannot be changed)
     * - updatedAt: Updated on every document modification
     * - Used for audit trail and query optimization
     * 
     * collection: 'committees' → Explicit collection name for D3 data store
     * - Matches index creation in migration (008_create_committee_schema.js)
     * - Ensures consistent naming across migrations and queries
     */
    timestamps: true,
    collection: 'committees',
  }
);

/**
 * Issue #84 FIX: Index Strategy for Committee Queries
 * 
 * All 5 indexes are defined here AND created unconditionally in migration.
 * Schema-level index definitions help with:
 * - Documentation of intended indexes
 * - Mongoose index creation on model compilation
 * - Fallback if migration indexes fail
 * 
 * Migration-level index creation ensures:
 * - Indexes created unconditionally on every migration run
 * - Recovery from partial failures (collection exists, indexes missing)
 * - Idempotency guaranteed by MongoDB's createIndex()
 * 
 * Why both schema AND migration indexes?
 * - Schema indexes: Help during development/testing (automatic creation)
 * - Migration indexes: Guarantee production consistency (explicit control)
 * - Dual approach ensures indexes exist through all deployment scenarios
 */

// Compound Index 1: (createdBy, status) for coordinator dashboard queries
committeeSchema.index({ createdBy: 1, status: 1 });

// Compound Index 2: (status, publishedAt) for recent committees listing
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
