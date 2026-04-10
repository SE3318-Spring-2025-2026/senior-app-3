const { submitDeliverable } = require('../services/deliverableService');
const { responseFormatter, errorHandler } = require('../utils/responseFormatter');

/**
 * POST /api/v1/groups/:groupId/deliverables - Submit deliverable (Process 4.5)
 * Issue #86: Triggers atomic D4/D6 writes via submitDeliverable()
 */
const submitDeliverableHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { committeeId, studentId, sprintId, type, storageRef } = req.body;
    const submittedBy = req.user?.id;

    // Validate required fields
    const requiredFields = { committeeId, groupId, studentId, sprintId, type, storageRef };
    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) {
        return res.status(400).json(
          responseFormatter(false, `${field} is required`, null, 400)
        );
      }
    }

    // Validate type enum
    const validTypes = ['proposal', 'statement-of-work', 'demonstration'];
    if (!validTypes.includes(type)) {
      return res.status(400).json(
        responseFormatter(
          false,
          `Type must be one of: ${validTypes.join(', ')}`,
          null,
          400
        )
      );
    }

    // Validate storageRef length
    if (storageRef.length < 5 || storageRef.length > 2048) {
      return res.status(400).json(
        responseFormatter(
          false,
          'storageRef must be between 5 and 2048 characters',
          null,
          400
        )
      );
    }

    const result = await submitDeliverable({
      committeeId,
      groupId,
      studentId,
      sprintId,
      type,
      storageRef,
      submittedBy,
    });

    res.status(201).json(
      responseFormatter(true, 'Deliverable submitted successfully', result, 201)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

module.exports = {
  submitDeliverableHandler,
};
