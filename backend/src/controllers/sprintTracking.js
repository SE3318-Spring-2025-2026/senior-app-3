const {
  recalculateSprintRatios,
  RatioServiceError
} = require('../services/contributionRatioService');

async function recalculateContributionRatios(req, res) {
  const { groupId, sprintId } = req.params;
  const userId = req.user?.id;

  if (!groupId || !sprintId) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_INPUT',
      message: 'groupId and sprintId are required path parameters.'
    });
  }

  try {
    const summary = await recalculateSprintRatios(groupId, sprintId, userId);
    return res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    if (error instanceof RatioServiceError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details || undefined
      });
    }

    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to recalculate sprint contribution ratios.',
      status: 500
    });
  }
}

module.exports = {
  recalculateContributionRatios
};
