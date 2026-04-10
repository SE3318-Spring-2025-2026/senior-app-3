const {
  validateCommitteeAssignment,
  submitDeliverable,
  DeliverableServiceError,
} = require('../services/deliverableService');
const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * Submit a deliverable for a group.
 * 
 * Validates committee assignment, enforces schedule window,
 * stores deliverable in D4, updates D6 sprint record, and establishes cross-reference.
 * 
 * Process 4.5 (Deliverable Submission)
 * DFD Flows: f11 (Student → 4.5), f12 (4.5 → D4), f13 (4.5 → D6), f14 (D4 → D6)
 * 
 * @param {object} req - Express request object
 * @param {string} req.params.groupId - Group identifier
 * @param {object} req.body - Request body
 * @param {string} req.body.committeeId - Committee identifier
 * @param {string} req.body.sprintId - Sprint identifier
 * @param {string} req.body.type - Deliverable type (proposal, statement-of-work, demonstration)
 * @param {string} req.body.storageRef - Storage reference (URL or file path)
 * @param {object} req.user - Authenticated user
 * @param {string} req.user.userId - User identifier
 * @param {string} req.user.role - User role
 * @param {object} res - Express response object
 */
const submitDeliverableHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { committeeId, sprintId, type, storageRef } = req.body;
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    // Validate request parameters
    if (!groupId || !committeeId || !sprintId || !type || !storageRef) {
      return res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Missing required fields: groupId, committeeId, sprintId, type, storageRef',
      });
    }

    // Validate type enum
    if (!['proposal', 'statement-of-work', 'demonstration'].includes(type)) {
      return res.status(400).json({
        code: 'INVALID_TYPE',
        message: 'Invalid deliverable type. Must be one of: proposal, statement-of-work, demonstration',
      });
    }

    // Validate storageRef format (basic validation)
    if (typeof storageRef !== 'string' || storageRef.length < 5 || storageRef.length > 2048) {
      return res.status(400).json({
        code: 'INVALID_STORAGE_REF',
        message: 'Storage reference must be a string between 5 and 2048 characters',
      });
    }

    // Check schedule window for deliverable submission
    const scheduleWindow = await ScheduleWindow.findOne({
      operation_type: 'deliverable_submission',
      status: 'active',
    });

    if (scheduleWindow) {
      const now = new Date();
      if (now < scheduleWindow.start_time || now > scheduleWindow.end_time) {
        return res.status(422).json({
          code: 'OUTSIDE_SCHEDULE_WINDOW',
          message: 'Deliverable submission is outside the allowed time window',
          window: {
            start: scheduleWindow.start_time,
            end: scheduleWindow.end_time,
          },
        });
      }
    }

    // Validate committee assignment
    const committee = await validateCommitteeAssignment(groupId);

    if (!committee) {
      return res.status(400).json({
        code: 'COMMITTEE_NOT_AVAILABLE',
        message: 'Group is not assigned to a published committee',
      });
    }

    // Verify committeeId matches
    if (committee.committeeId !== committeeId) {
      return res.status(403).json({
        code: 'COMMITTEE_MISMATCH',
        message: 'Provided committeeId does not match the group\'s assigned committee',
      });
    }

    // Perform atomic deliverable submission
    const result = await submitDeliverable({
      groupId,
      committeeId,
      sprintId,
      studentId: userId,
      type,
      storageRef,
      coordinatorId: userRole === 'coordinator' ? userId : null,
    });

    return res.status(201).json({
      deliverableId: result.deliverableId,
      committeeId: result.committeeId,
      groupId: result.groupId,
      type: result.type,
      submittedAt: result.submittedAt,
      storageRef: result.storageRef,
    });
  } catch (err) {
    if (err instanceof DeliverableServiceError) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    console.error('Deliverable submission error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during deliverable submission',
    });
  }
};

module.exports = {
  submitDeliverableHandler,
};
