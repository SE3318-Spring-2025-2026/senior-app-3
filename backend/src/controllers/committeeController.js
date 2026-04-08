const Committee = require('../models/Committee');
const User = require('../models/User');
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

    // ── 3. Duplicate name check (D3 query) ──────────────────────────────────
    const existing = await Committee.findOne({
      committeeName: committeeName.trim(),
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
      forwardedToAdvisorAssignment: false,
    });

    await committee.save();

    // ── 5. Forward to Process 4.2 (DFD flow f02: 4.1 → 4.2) ─────────────────
    committee.forwardedToAdvisorAssignment = true;
    await committee.save();

    // ── 6. Audit log ─────────────────────────────────────────────────────────
    try {
      await createAuditLog({
        action: 'COMMITTEE_CREATED',
        actorId: requesterId,
        targetId: committee.committeeId,
        payload: {
          committeeName: committee.committeeName,
          description: committee.description,
          coordinatorId: requesterId,
          forwardedToAdvisorAssignment: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Committee creation audit log failed:', auditError.message);
    }

    // ── 7. 201 Response ──────────────────────────────────────────────────────
    return res.status(201).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      coordinatorId: committee.coordinatorId,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      createdAt: committee.createdAt,
    });
  } catch (error) {
    console.error('Create committee error:', error);

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
        forwardedToJuryValidation: c.forwardedToJuryValidation,
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
      forwardedToJuryValidation: committee.forwardedToJuryValidation,
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

/**
 * Process 4.3 — Add Jury Members
 * OpenAPI: POST /committees/{committeeId}/jury
 * DFD Flow f10: Coordinator → 4.3
 * DFD Flow f04: 4.3 → 4.4 (Validate Jury)
 *
 * Acceptance Criteria:
 *  - Coordinator role only (403 for others)
 *  - Committee not found → 404
 *  - Invalid jury member IDs (non-existent or non-professor) → 400
 *  - Jury assignment conflict (already assigned) → 409
 *  - Returns updated committee object with full juryIds[]
 *  - Jury list forwarded to Process 4.4 (f04 flag set)
 */
const addJuryMembers = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;
    const requesterId = req.user.userId;
    const requesterRole = req.user.role;

    // ── 1. Role guard: Coordinator only (f10: Coordinator → 4.3) ─────────────
    if (requesterRole !== 'coordinator') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only a Coordinator can assign jury members to a committee.',
      });
    }

    // ── 2. Input validation ───────────────────────────────────────────────────
    if (!juryIds || !Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: 'juryIds must be a non-empty array of professor user IDs.',
      });
    }

    // Deduplicate incoming list
    const uniqueIncoming = [...new Set(juryIds)];

    // ── 3. Committee existence check (D3 query) ───────────────────────────────
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: `Committee "${committeeId}" not found.`,
      });
    }

    // ── 4. Validate each juryId: must exist and have role 'professor' ─────────
    const users = await User.find({ userId: { $in: uniqueIncoming } }).select(
      'userId role'
    );

    const foundIds = new Set(users.map((u) => u.userId));
    const missingIds = uniqueIncoming.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: `The following user IDs were not found: ${missingIds.join(', ')}.`,
        invalidIds: missingIds,
      });
    }

    const nonProfessors = users.filter((u) => u.role !== 'professor');
    if (nonProfessors.length > 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: `Jury members must have the 'professor' role. Invalid IDs: ${nonProfessors
          .map((u) => u.userId)
          .join(', ')}.`,
        invalidIds: nonProfessors.map((u) => u.userId),
      });
    }

    // ── 5. Conflict check: IDs already in juryIds array ──────────────────────
    const existingSet = new Set(committee.juryIds);
    const conflicting = uniqueIncoming.filter((id) => existingSet.has(id));

    if (conflicting.length > 0) {
      return res.status(409).json({
        code: 'JURY_ASSIGNMENT_CONFLICT',
        message: `The following professors are already assigned as jury members: ${conflicting.join(
          ', '
        )}.`,
        conflictingIds: conflicting,
      });
    }

    // ── 6. D3 write: merge new juryIds into committee record ──────────────────
    committee.juryIds = [...committee.juryIds, ...uniqueIncoming];

    // ── 7. Forward to Process 4.4 (DFD flow f04: 4.3 → 4.4) ─────────────────
    committee.forwardedToJuryValidation = true;

    await committee.save();

    // ── 8. Audit log ─────────────────────────────────────────────────────────
    try {
      await createAuditLog({
        action: 'JURY_ASSIGNED',
        actorId: requesterId,
        targetId: committee.committeeId,
        payload: {
          committeeId: committee.committeeId,
          committeeName: committee.committeeName,
          newJuryIds: uniqueIncoming,
          totalJuryIds: committee.juryIds,
          forwardedToJuryValidation: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Jury assignment audit log failed:', auditError.message);
    }

    // ── 9. Response (OpenAPI: POST /committees/{committeeId}/jury) ────────────
    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      coordinatorId: committee.coordinatorId,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      forwardedToAdvisorAssignment: committee.forwardedToAdvisorAssignment,
      forwardedToJuryValidation: committee.forwardedToJuryValidation,
      updatedAt: committee.updatedAt,
    });
  } catch (error) {
    console.error('Add jury members error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while assigning jury members.',
    });
  }
};

module.exports = {
  createCommittee,
  listCommittees,
  getCommittee,
  addJuryMembers,
};
