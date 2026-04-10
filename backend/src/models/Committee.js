const mongoose = require('mongoose');

/**
 * Issue #87: Committee Data Store (D3)
 * 
 * Stores committee configurations and lifecycle tracking for Process 4.0.
 * Used by:
 * - Process 4.1-4.4: Committee creation, advisor/jury assignment, validation
 * - Process 4.5: Committee publication with notification dispatch (Flow f09)
 * 
 * Status Workflow: draft → validated → published
 * 
 * DFD Flows:
 * - f06: 4.5 → D3 (committee publish - write final record)
 * - f09: 4.5 → Notification Service (dispatch on publish)
 */
const committeeSchema = new mongoose.Schema(
  {
    /**
     * Issue #87: Unique committee identifier
     * Generated on creation with pattern: COMM_${timestamp}_${random}
     */
    committeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /**
     * Issue #87: Committee name (must be unique)
     * Duplicate name check prevents concurrent creation
     */
    committeeName: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /**
     * Issue #87: Optional committee description
     */
    description: {
      type: String,
      default: '',
    },
    /**
     * Issue #87: Array of advisor IDs (Process 4.2)
     * Aggregated with juryIds and group members for notification recipients
     * Set deduplication ensures no duplicate notifications
     */
    advisorIds: [
      {
        type: String,
      },
    ],
    /**
     * Issue #87: Array of jury member IDs (Process 4.3)
     * Aggregated with advisorIds and group members for notification recipients
     */
    juryIds: [
      {
        type: String,
      },
    ],
    /**
     * Issue #87: Committee status lifecycle
     * - draft: Initial creation (Process 4.1)
     * - validated: Passed validation checks (Process 4.4)
     * - published: Ready for student submissions, notifications sent (Process 4.5)
     * 
     * Only validated committees can be published.
     * Published committees cannot be modified.
     */
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
      index: true,
    },
    /**
     * Issue #87: Coordinator who created the committee (Process 4.1)
     */
    createdBy: String,
    /**
     * Issue #87: Coordinator who published the committee (Process 4.5)
     * Used to track who triggered notification dispatch (Flow f09)
     */
    publishedBy: String,
    /**
     * Issue #87: Timestamp when committee was published (Process 4.5)
     * Included in notification payload for audit trail
     */
    publishedAt: Date,
    /**
     * Issue #87: Coordinator who validated the committee (Process 4.4)
     */
    validatedBy: String,
    /**
     * Issue #87: Timestamp when committee was validated (Process 4.4)
     */
    validatedAt: Date,
  },
  {
    timestamps: true,
  }
);

/**
 * Issue #87: Indexes for query optimization
 * 
 * Index 1: (createdBy, status)
 *   - Used in Process 4.4: Query committees by coordinator and status
 *   - Supports validation workflow
 * 
 * Index 2: (status, publishedAt DESC)
 *   - Used in Process 4.5: Query published committees, sort by publish time
 *   - Supports retrieving recent publications for notifications
 */
committeeSchema.index({ createdBy: 1, status: 1 });
committeeSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model('Committee', committeeSchema);
