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
        forwardedToAdvisorAssignment: c.forwardedToAdvisorAssignment,
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
 * POST /committees/:committeeId/advisors — Assign Advisors to Committee (Process 4.2)
 */
const assignCommitteeAdvisors = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;
    const requesterId = req.user.userId;
    const requesterRole = req.user.role;

    if (requesterRole !== 'coordinator') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only a Coordinator can assign advisors to a committee.',
      });
    }

    if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'advisorIds must be a non-empty array.',
      });
    }

    const committee = await Committee.findOne({ committeeId });
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found.',
      });
    }

    // ── Validate each advisorId: must exist and have role 'professor' ─────────
    const users = await User.find({ userId: { $in: advisorIds } }).select('userId role');
    const foundIds = new Set(users.map((u) => u.userId));
    const missingIds = advisorIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        code: 'INVALID_ADVISOR_IDS',
        message: `The following user IDs were not found: ${missingIds.join(', ')}.`,
      });
    }

    const nonProfessors = users.filter((u) => u.role !== 'professor');
    if (nonProfessors.length > 0) {
      return res.status(400).json({
        code: 'INVALID_ADVISOR_IDS',
        message: `Advisors must have the 'professor' role.`,
      });
    }

    // [Critical] Advisor-Jury Overlap Conflict check
    const overlap = advisorIds.filter(id => committee.juryIds.includes(id));
    if (overlap.length > 0) {
      return res.status(409).json({
        code: 'JURY_ADVISOR_OVERLAP',
        message: `Professor(s) ${overlap.join(', ')} are already assigned as jury members on this committee.`,
      });
    }

    // [High] Global Conflicting Role Check
    const globalConflicts = await Committee.find({
      committeeId: { $ne: committeeId },
      $or: [
        { advisorIds: { $in: advisorIds } },
        { juryIds: { $in: advisorIds } }
      ],
      status: { $in: ['draft', 'validated', 'published'] }
    });

    if (globalConflicts.length > 0) {
      const conflictedProfessors = [];
      globalConflicts.forEach(c => {
        advisorIds.forEach(id => {
          if (c.advisorIds.includes(id) || c.juryIds.includes(id)) {
            conflictedProfessors.push(`${id} (in committee "${c.committeeName}")`);
          }
        });
      });

      return res.status(409).json({
        code: 'GLOBAL_ROLE_CONFLICT',
        message: `The following professor(s) are already assigned to other committees: ${conflictedProfessors.join(', ')}.`,
      });
    }

    // Filter out duplicates already in advisorIds
    const newAdvisors = advisorIds.filter(id => !committee.advisorIds.includes(id));
    if (newAdvisors.length > 0) {
      committee.advisorIds.push(...newAdvisors);
      await committee.save();

      try {
        await createAuditLog({
          action: 'COMMITTEE_UPDATED',
          actorId: requesterId,
          targetId: committeeId,
          payload: {
            committeeId: committee.committeeId,
            addedAdvisors: newAdvisors,
            totalAdvisors: committee.advisorIds.length,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed for advisor assignment:', auditError.message);
      }
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
    console.error('Assign advisors error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  }
};

/**
 * POST /committees/:committeeId/jury — Add Jury Members (Process 4.3)
 */
const addJuryMembers = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;
    const requesterId = req.user.userId;
    const requesterRole = req.user.role;

    // ── 1. Role guard: Coordinator only
    if (requesterRole !== 'coordinator') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only a Coordinator can assign jury members to a committee.',
      });
    }

    // ── 2. Input validation
    if (!juryIds || !Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: 'juryIds must be a non-empty array.',
      });
    }

    // Deduplicate incoming list
    const uniqueIncoming = [...new Set(juryIds)];

    // ── 3. Committee existence check (D3 query)
    const committee = await Committee.findOne({ committeeId });
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found.',
      });
    }

    // ── 4. Validate each juryId: must exist and have role 'professor' ─────────
    const users = await User.find({ userId: { $in: uniqueIncoming } }).select('userId role');
    const foundIds = new Set(users.map((u) => u.userId));
    const missingIds = uniqueIncoming.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: `The following user IDs were not found: ${missingIds.join(', ')}.`,
      });
    }

    const nonProfessors = users.filter((u) => u.role !== 'professor');
    if (nonProfessors.length > 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: `Jury members must have the 'professor' role.`,
      });
    }

    // [Critical] Advisor-Jury Overlap Conflict check
    const overlap = uniqueIncoming.filter(id => committee.advisorIds.includes(id));
    if (overlap.length > 0) {
      return res.status(409).json({
        code: 'JURY_ADVISOR_OVERLAP',
        message: `Professor(s) ${overlap.join(', ')} are already assigned as advisors on this committee.`,
      });
    }

    // [High] Global Conflicting Role Check
    const globalConflicts = await Committee.find({
      committeeId: { $ne: committeeId },
      $or: [
        { advisorIds: { $in: uniqueIncoming } },
        { juryIds: { $in: uniqueIncoming } }
      ],
      status: { $in: ['draft', 'validated', 'published'] }
    });

    if (globalConflicts.length > 0) {
      const conflictedProfessors = [];
      globalConflicts.forEach(c => {
        uniqueIncoming.forEach(id => {
          if (c.advisorIds.includes(id) || c.juryIds.includes(id)) {
            conflictedProfessors.push(`${id} (in committee "${c.committeeName}")`);
          }
        });
      });

      return res.status(409).json({
        code: 'GLOBAL_ROLE_CONFLICT',
        message: `The following professor(s) are already assigned to other committees: ${conflictedProfessors.join(', ')}.`,
      });
    }

    // ── 5. Conflict check: IDs already in juryIds array ──────────────────────
    const existingSet = new Set(committee.juryIds);
    const conflicting = uniqueIncoming.filter((id) => existingSet.has(id));

    if (conflicting.length > 0) {
      return res.status(409).json({
        code: 'JURY_ASSIGNMENT_CONFLICT',
        message: `The following professors are already assigned as jury members: ${conflicting.join(', ')}.`,
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
          addedJuryMembers: uniqueIncoming,
          totalJuryMembers: committee.juryIds.length,
          forwardedToJuryValidation: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Jury assignment audit log failed:', auditError.message);
    }

    // ── 9. Response
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
  assignCommitteeAdvisors,
  addJuryMembers,
};
