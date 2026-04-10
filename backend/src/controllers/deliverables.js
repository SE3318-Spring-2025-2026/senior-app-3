const {
  submitDeliverable,
  DeliverableServiceError,
} = require('../services/deliverableService');

/**
 * Submit a deliverable
 * POST /api/v1/groups/{groupId}/deliverables
 */
const submitDeliverableHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { committeeId, sprintId, type, storageRef } = req.body;
    const submittedBy = req.user?.userId;
    const studentId = req.user?.userId;

    // Validate required fields
    if (!committeeId || !sprintId || !type || !storageRef) {
      return res.status(400).json({
        error: 'Missing required fields: committeeId, sprintId, type, storageRef',
      });
    }

    // Validate type enum
    const validTypes = ['proposal', 'statement-of-work', 'demonstration'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Validate storageRef
    if (storageRef.length < 5 || storageRef.length > 2048) {
      return res.status(400).json({
        error: 'Storage reference must be between 5 and 2048 characters',
      });
    }

    // Call service to submit deliverable
    const result = await submitDeliverable({
      committeeId,
      groupId,
      studentId,
      sprintId,
      type,
      storageRef,
      submittedBy,
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof DeliverableServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Submit deliverable error:', error);
    res.status(500).json({ error: 'Failed to submit deliverable' });
  }
};

module.exports = {
  submitDeliverableHandler,
};
