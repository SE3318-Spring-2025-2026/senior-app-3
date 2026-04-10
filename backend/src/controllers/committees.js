const {
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
} = require('../services/committeeService');
const { responseFormatter, errorHandler } = require('../utils/responseFormatter');

/**
 * POST /api/v1/committees - Create committee draft (Process 4.1)
 */
const createCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeName, description, advisorIds = [], juryIds = [] } = req.body;
    const coordinatorId = req.user?.id;

    if (!committeeName || typeof committeeName !== 'string' || committeeName.trim().length === 0) {
      return res.status(400).json(
        responseFormatter(false, 'Committee name is required', null, 400)
      );
    }

    const committee = await createCommitteeDraft(committeeName, coordinatorId, {
      description,
      advisorIds,
      juryIds,
    });

    res.status(201).json(
      responseFormatter(true, 'Committee created successfully', committee, 201)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

/**
 * POST /api/v1/committees/:committeeId/validate - Validate committee (Process 4.2)
 */
const validateCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;

    const committee = await validateCommittee(committeeId);

    res.status(200).json(
      responseFormatter(true, 'Committee validated successfully', committee, 200)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

/**
 * POST /api/v1/committees/:committeeId/publish - Publish committee (Process 4.5)
 * Issue #86: Triggers atomic D6 updates via publishCommittee()
 */
const publishCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;
    const publishedBy = req.user?.id;

    const committee = await publishCommittee(committeeId, publishedBy);

    res.status(200).json(
      responseFormatter(true, 'Committee published successfully', committee, 200)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

/**
 * GET /api/v1/committees/:committeeId - Get committee
 */
const getCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;

    const committee = await getCommittee(committeeId);

    res.status(200).json(
      responseFormatter(true, 'Committee retrieved successfully', committee, 200)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

/**
 * POST /api/v1/committees/:committeeId/advisors - Assign advisors (Process 4.3)
 */
const assignAdvisorsHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;

    if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
      return res.status(400).json(
        responseFormatter(false, 'advisorIds must be a non-empty array', null, 400)
      );
    }

    const committee = await assignAdvisors(committeeId, advisorIds);

    res.status(200).json(
      responseFormatter(true, 'Advisors assigned successfully', committee, 200)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

/**
 * POST /api/v1/committees/:committeeId/jury - Assign jury members (Process 4.4)
 */
const assignJuryHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;

    if (!Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json(
        responseFormatter(false, 'juryIds must be a non-empty array', null, 400)
      );
    }

    const committee = await assignJury(committeeId, juryIds);

    res.status(200).json(
      responseFormatter(true, 'Jury members assigned successfully', committee, 200)
    );
  } catch (error) {
    errorHandler(error, res);
  }
};

module.exports = {
  createCommitteeHandler,
  validateCommitteeHandler,
  publishCommitteeHandler,
  getCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
};
