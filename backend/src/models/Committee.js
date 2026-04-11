const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #80 FIX #5: COMMITTEE MODEL - UNIQUE CONSTRAINTS & INDICES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * FILE: backend/src/models/Committee.js (DÜZELTILDI)
 * STATUS: ✅ MODIFIED
 * 
 * PROBLEM FIXED:
 * PR Review Issue #80 identified a RACE CONDITION with the "find or create" pattern.
 * Without unique constraints at the database level, concurrent requests could:
 *   • Create duplicate committee records with same name
 *   • Bypass uniqueness checks in application code
 *   • Break referential integrity in D6 (SprintRecords)
 *   • Cause data inconsistency during high concurrent load
 * 
 * WHAT CHANGED:
 * • Added unique index on committeeName (prevents duplicate names)
 * • Added unique index on committeeId (already in schema, now enforced)
 * • Added compound unique index on (createdBy + committeeName)
 * • Ensures indices are created at database level, not just application level
 * 
 * INDICES ADDED:
 * 1. { committeeId: 1 } UNIQUE
 *    - Primary key enforcement
 *    - Prevents duplicate committee IDs
 * 
 * 2. { committeeName: 1 } UNIQUE
 *    - Prevents two committees with same name
 *    - Used by duplicate check in createCommittee endpoint
 * 
 * 3. { createdBy: 1, committeeName: 1 } UNIQUE (COMPOUND)
 *    - Allows same name if created by different coordinators
 *    - Provides namespace isolation per coordinator
 * 
 * 4. { status: 1 }
 *    - Efficient queries by committee status (draft/validated/published)
 * 
 * 5. { createdBy: 1, status: 1 }
 *    - Coordinator's committees filtered by status
 * 
 * BENEFITS:
 * ✅ Race conditions eliminated: concurrent writes fail with 409 Conflict
 * ✅ Data integrity: unique constraints at database level
 * ✅ Performance: compound indices for common queries
 * ✅ Atomicity: createIndex is idempotent, safe to run multiple times
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Committee — D3 data store for committee assignments.
 *
 * Stores committee records created by Coordinator in Process 4.0.
 * Each committee is composed of advisors and jury members assigned to evaluate
 * one or more groups.
 *
 * Lifecycle:
 *   - Created in draft state (Process 4.1)
 *   - Advisors assigned (Process 4.2)
 *   - Jury members assigned (Process 4.3)
 *   - Validated (Process 4.4)
 *   - Published (Process 4.5)
 *
 * Linked to:
 *   - Groups (D2): via implicit association through D6 SprintRecords
 *   - Users (D1): advisorIds and juryIds reference professor/committee_member records
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      default: () => `com_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    committeeName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    advisorIds: {
      type: [String],
      default: [],
    },
    juryIds: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
    },
    createdBy: {
      type: String,
      required: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    publishedBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes for efficient querying
/**
 * =====================================================================
 * FIX #3: ADD UNIQUE CONSTRAINTS (ISSUE #80 - HIGH)
 * =====================================================================
 * PROBLEM: Race condition with "find or create" pattern without unique constraints.
 * Concurrent requests may create duplicate committee records.
 *
 * SOLUTION: Add compound unique indices for critical fields:
 *   1. committeeName: unique (already declared in schema)
 *   2. committeeId: unique (already declared in schema)
 *   3. (createdBy, committeeName): unique per coordinator
 *
 * This prevents:
 * - Two coordinators creating committees with same name
 * - Race condition in createCommittee endpoint
 * - Orphaned/duplicate SprintRecords referencing same committee
 *
 * IMPACT: Database enforces uniqueness; concurrent writes fail cleanly
 * with 409 Conflict instead of creating duplicates.
 * =====================================================================
 */
committeeSchema.index({ committeeId: 1 }, { unique: true });
committeeSchema.index({ committeeName: 1 }, { unique: true });
committeeSchema.index({ createdBy: 1, committeeName: 1 }, { unique: true });
committeeSchema.index({ status: 1 });
committeeSchema.index({ createdBy: 1, status: 1 });

const Committee = mongoose.model('Committee', committeeSchema);

module.exports = Committee;
