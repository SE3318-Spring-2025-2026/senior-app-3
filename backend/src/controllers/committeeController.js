const Committee = require('../models/Committee');
const { createAuditLog } = require('../services/auditService');

/**
 * Process 4.1 — Create Committee
 * DFD Flow f01: Coordinator → 4.1
 * DFD Flow f02: 4.1 → 4.2
 *
 * Acceptance Criteria:
 *  - Coordinator role only (403 for others)
 *  - Duplicate committee name → 409
 *  - Written to D3 with status: draft, empty advisorIds / juryIds
 *  - Committee draft forwarded to Process 4.2 (f02 flagged)
 *  - Returns 201 with committeeId
 */
const createCommittee = async (req, res) => {
  try {
    const { committeeName, coordinatorId, description } = req.body;
    const requesterId = req.user.userId;
    const requesterRole = req.user.role;

    // ── 1. Role guard: Coordinator only ──────────────────────────────────────
    if (requesterRole !== 'coordinator') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only a Coordinator can create a committee.',
      });
    }

    // ── 2. Input validation ───────────────────────────────────────────────────
    if (!committeeName || !committeeName.trim()) {
      return res.status(400).json({
        code: 'MISSING_FIELDS',
        message: 'committeeName is required.',
      });
    }

    if (committeeName.trim().length > 100) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'committeeName cannot exceed 100 characters.',
      });
    }

    if (description && description.trim().length > 500) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'description cannot exceed 500 characters.',
      });
    }

    if (!coordinatorId || !coordinatorId.trim()) {
      return res.status(400).json({
        code: 'MISSING_FIELDS',
        message: 'coordinatorId is required.',
      });
    }

    // Optional: ensure coordinatorId in body matches the authenticated user
    if (coordinatorId !== requesterId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'coordinatorId must match the authenticated coordinator.',
      });
    }

    // ── 3. Duplicate name check (D3 query, case-insensitive) ────────────────
    // Escape special regex characters from user input before building the pattern
    const escapedName = committeeName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Committee.findOne({
      committeeName: { $regex: new RegExp(`^${escapedName}$`, 'i') },
    });

    if (existing) {
      return res.status(409).json({
        code: 'DUPLICATE_COMMITTEE_NAME',
        message: `A committee with the name "${committeeName.trim()}" already exists. Please choose a unique name.`,
      });
    }

    // ── 4. Write D3: Create committee draft record ───────────────────────────
    const committee = new Committee({
      committeeName: committeeName.trim(),
      description: description ? description.trim() : null,
      coordinatorId: requesterId,
      advisorIds: [],
      juryIds: [],
      status: 'draft',
      forwardedToAdvisorAssignment: true,
    });

    await committee.save();

    // ── 6. Audit log ─────────────────────────────────────────────────────────
    try {
      await createAuditLog({
        action: 'COMMITTEE_CREATED',
        actorId: requesterId,
        targetId: committee.committeeId,
        payload: {
          committeeId: committee.committeeId,
          committeeName: committee.committeeName,
          description: committee.description,
          coordinatorId: requesterId,
          forwardedToAdvisorAssignment: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      // Non-fatal: log but don't fail the request
      console.error('Committee creation audit log failed:', auditError.message);
    }

    // ── 7. 201 Response (OpenAPI: POST /committees) ──────────────────────────
    return res.status(201).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      coordinatorId: committee.coordinatorId,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      forwardedToAdvisorAssignment: committee.forwardedToAdvisorAssignment,
      createdAt: committee.createdAt,
    });
  } catch (error) {
    console.error('Create committee error:', error);

    // Handle Mongoose unique index violation (race condition safety net)
    // Covers both plain unique index violations and collation-based unique violations
    if (error.code === 11000 && error.keyPattern?.committeeName) {
      return res.status(409).json({
        code: 'DUPLICATE_COMMITTEE_NAME',
        message: 'A committee with this name already exists.',
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while creating the committee.',
    });
  }
};

/**
 * GET /committees — List all committees (Coordinator or Admin)
 */
const listCommittees = async (req, res) => {
  try {
    const requesterRole = req.user.role;

    if (!['coordinator', 'admin'].includes(requesterRole)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only Coordinators and Admins can list committees.',
      });
    }

    const committees = await Committee.find({}).sort({ createdAt: -1 });

    return res.status(200).json({
      committees: committees.map((c) => ({
        committeeId: c.committeeId,
        committeeName: c.committeeName,
        description: c.description,
        coordinatorId: c.coordinatorId,
        advisorIds: c.advisorIds,
        juryIds: c.juryIds,
        status: c.status,
        createdAt: c.createdAt,
      })),
      total: committees.length,
    });
  } catch (error) {
    console.error('List committees error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while listing committees.',
    });
  }
};

/**
 * GET /committees/:committeeId — Get a single committee
 */
const getCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found.',
      });
    }

    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      coordinatorId: committee.coordinatorId,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      forwardedToAdvisorAssignment: committee.forwardedToAdvisorAssignment,
      createdAt: committee.createdAt,
      updatedAt: committee.updatedAt,
    });
  } catch (error) {
    console.error('Get committee error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  }
};

module.exports = {
  createCommittee,
  listCommittees,
  getCommittee,
};
