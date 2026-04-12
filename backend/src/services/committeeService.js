const Committee = require('../models/Committee');
const { createAuditLog } = require('./auditService');

/**
 * Issue #84 FIX: Committee Service - Write Operations & Data Integrity
 * 
 * ════════════════════════════════════════════════════════════════════════
 * SERVICE LAYER FOR D3 COMMITTEE DATA STORE
 * ════════════════════════════════════════════════════════════════════════
 * 
 * Purpose:
 * Implements all write operations (create, validate, publish) and read
 * operations for the Committee data store (D3) used by Process 4.0-4.5.
 * 
 * Integration with Issue #84 Fix:
 * - Relies on migration 008_create_committee_schema.js for DB schema setup
 * - Depends on unique constraint on committeeName (created unconditionally)
 * - Assumes all 5 indexes exist (guaranteed by migration)
 * - Uses CommitteeServiceError for consistent error handling
 * 
 * Critical Operations Protected by DB Constraints:
 * 1. Duplicate committee name check (409 Conflict)
 *    - Application checks via findOne({committeeName})
 *    - Database enforces via unique index on committeeName
 *    - Dual protection: app-layer and DB-level constraints
 * 
 * 2. Status lifecycle enforcement (draft → validated → published)
 *    - Enforced by service logic (checks current status before transition)
 *    - Prevents invalid state transitions (e.g., draft → draft)
 *    - Prevents downgrade (e.g., published → draft)
 * 
 * 3. Atomicity for multi-field updates
 *    - publishedAt and publishedBy updated together
 *    - validatedAt and validatedBy updated together
 *    - No partial states possible (MongoDB atomic updates)
 * 
 * Error Handling Strategy:
 * - ValidationError → 400 Bad Request (input validation failed)
 * - NotFoundError → 404 Not Found (committee doesn't exist)
 * - ConflictError → 409 Conflict (duplicate name or invalid state)
 * - InternalError → 500 Internal Server Error (unexpected DB errors)
 * 
 * Audit Trail Integration:
 * - Every write operation creates audit log entry
 * - Tracks: who performed action, what changed, when
 * - Enables admin review and compliance auditing
 * 
 * Reference: Issue #84 PR Review - D3 Committees Data Store Schema & Write Operations
 */

/**
 * Custom error class for committee service operations
 * 
 * Provides consistent error handling with HTTP status codes and error codes
 * for accurate error propagation to API layer and client error handling.
 * 
 * @param {string} message - Human-readable error message
 * @param {number} status - HTTP status code (400, 404, 409, 500)
 * @param {string} code - Machine-readable error code (for client parsing)
 */
class CommitteeServiceError extends Error {
  constructor(message, status = 500, code = 'COMMITTEE_ERROR') {
    super(message);
    this.name = 'CommitteeServiceError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Issue #84 FIX: Create Committee Draft (Process 4.1)
 * 
 * Creates initial committee draft with empty advisor/jury lists.
 * Validates that committee name is unique across system.
 * 
 * Data Integrity: Duplicate Prevention
 * ─────────────────────────────────────
 * 1. Application Layer Check:
 *    - findOne({ committeeName }) queries D3 before creation
 *    - Returns 409 Conflict if name exists
 *    - Fast rejection without waiting for DB constraint violation
 * 
 * 2. Database Layer Check:
 *    - Unique index on committeeName (created by migration 008)
 *    - MongoDB enforces constraint on insert/update
 *    - Prevents duplicates even if app layer check bypassed
 *    - Guaranteed by unconditional index creation in migration
 * 
 * Why Both Checks?
 * - Application check: Better UX (clear 409 error, not DB error)
 * - Database check: Last-line defense (ensures invariant even with bugs)
 * - Together they provide defense-in-depth for critical constraint
 * 
 * Status Lifecycle:
 * - Created with status: 'draft' (cannot be changed during creation)
 * - Arrays initialized: advisorIds: [], juryIds: []
 * - Timestamps: createdAt set automatically, updatedAt set on save
 * 
 * @param {object} data - Committee creation data
 * @param {string} data.committeeName - Committee name (MUST be unique)
 * @param {string} data.description - Optional committee description
 * @param {string} data.coordinatorId - Coordinator creating the committee
 * @returns {Promise<object>} Created Committee document with status: draft
 * @throws {CommitteeServiceError} 409 if name exists, 500 if DB error
 */
const createCommitteeDraft = async (data) => {
  try {
    const { committeeName, description, coordinatorId } = data;

    /**
     * Issue #84 FIX: Application-Layer Duplicate Check
     * 
     * Queries D3 for existing committee with same name
     * Fast rejection with informative error message
     * Part of defense-in-depth (app + DB layer checks)
     * 
     * If exists → throw 409 Conflict
     * If not exists → proceed with creation
     */
    const existingCommittee = await Committee.findOne({ committeeName });
    if (existingCommittee) {
      throw new CommitteeServiceError(
        `Committee with name "${committeeName}" already exists`,
        409,
        'DUPLICATE_COMMITTEE_NAME'
      );
    }

    /**
     * Issue #84 FIX: Create Draft Document
     * 
     * Initialize committee with:
     * - status: 'draft' (immutable on creation, only updatable via validateCommittee)
     * - advisorIds: [] (populated later via assignAdvisors)
     * - juryIds: [] (populated later via assignJury)
     * - createdBy: coordinatorId (recorded for audit trail)
     * - MongoDB will auto-set createdAt and updatedAt (timestamps: true)
     */
    const committee = new Committee({
      committeeName,
      description: description || null,
      createdBy: coordinatorId,
      status: 'draft',
      advisorIds: [],
      juryIds: [],
    });

    await committee.save();

    /**
     * Audit Log for Process 4.1
     * Records: Who created, what committee, status
     */
    await createAuditLog({
      action: 'COMMITTEE_CREATED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        committeeName: committee.committeeName,
        status: 'draft',
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to create committee draft: ${err.message}`,
      500,
      'DRAFT_CREATION_ERROR'
    );
  }
};

/**
 * Validate committee setup (set status to validated).
 * Called by Process 4.4 (Validate Committee Setup).
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string} coordinatorId - Coordinator performing validation
 * @returns {Promise<object>} Updated Committee document
 * @throws {CommitteeServiceError} If committee not found (404) or already published (409)
 */
const validateCommittee = async (committeeId, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Cannot validate an already published committee',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    committee.status = 'validated';
    committee.validatedAt = new Date();
    committee.validatedBy = coordinatorId;
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_VALIDATED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        committeeName: committee.committeeName,
        advisorCount: committee.advisorIds.length,
        juryCount: committee.juryIds.length,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to validate committee: ${err.message}`,
      500,
      'VALIDATION_ERROR'
    );
  }
};

/**
 * Publish a validated committee (set status to published).
 * Called by Process 4.5 (Publish Committee) - Flow f06: 4.5 → D3.
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string} coordinatorId - Coordinator publishing the committee
 * @returns {Promise<object>} Updated Committee document
 * @throws {CommitteeServiceError} If committee not found (404), not validated (400), or already published (409)
 */
const publishCommittee = async (committeeId, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Committee is already published',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    if (committee.status !== 'validated') {
      throw new CommitteeServiceError(
        'Committee must be validated before publishing',
        400,
        'COMMITTEE_NOT_VALIDATED'
      );
    }

    committee.status = 'published';
    committee.publishedAt = new Date();
    committee.publishedBy = coordinatorId;
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_PUBLISHED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        committeeName: committee.committeeName,
        advisorCount: committee.advisorIds.length,
        juryCount: committee.juryIds.length,
        publishedAt: committee.publishedAt,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to publish committee: ${err.message}`,
      500,
      'PUBLISH_ERROR'
    );
  }
};

/**
 * Retrieve a committee by ID.
 * Used for validation and status checks.
 * 
 * @param {string} committeeId - Committee identifier
 * @returns {Promise<object>} Committee document or null if not found
 */
const getCommittee = async (committeeId) => {
  try {
    return await Committee.findOne({ committeeId });
  } catch (err) {
    throw new CommitteeServiceError(
      `Failed to retrieve committee: ${err.message}`,
      500,
      'RETRIEVE_ERROR'
    );
  }
};

/**
 * Assign advisors to a committee.
 * Called by Process 4.2 (Assign Advisors).
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string[]} advisorIds - Array of advisor user IDs
 * @param {string} coordinatorId - Coordinator performing assignment
 * @returns {Promise<object>} Updated Committee document
 */
const assignAdvisors = async (committeeId, advisorIds, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Cannot modify a published committee',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    // Remove duplicates and ensure it's an array
    committee.advisorIds = [...new Set(advisorIds || [])];
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_ADVISORS_ASSIGNED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        advisorCount: committee.advisorIds.length,
        advisorIds: committee.advisorIds,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to assign advisors: ${err.message}`,
      500,
      'ASSIGN_ADVISORS_ERROR'
    );
  }
};

/**
 * Assign jury members to a committee.
 * Called by Process 4.3 (Add Jury Members).
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string[]} juryIds - Array of jury member user IDs
 * @param {string} coordinatorId - Coordinator performing assignment
 * @returns {Promise<object>} Updated Committee document
 */
const assignJury = async (committeeId, juryIds, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Cannot modify a published committee',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    // Remove duplicates and ensure it's an array
    committee.juryIds = [...new Set(juryIds || [])];
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_JURY_ASSIGNED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        juryCount: committee.juryIds.length,
        juryIds: committee.juryIds,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to assign jury: ${err.message}`,
      500,
      'ASSIGN_JURY_ERROR'
    );
  }
};

module.exports = {
  CommitteeServiceError,
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
};
