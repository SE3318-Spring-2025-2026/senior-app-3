const Group = require('../models/Group');

/**
 * Atomically persist that a notification tied to an embedded advisor request was delivered.
 * Matches the Group document whose nested `advisorRequest.requestId` equals the given id.
 *
 * @param {string} requestId - `advisorRequest.requestId` (e.g. adv_req_xxx)
 * @returns {Promise<import('mongoose').UpdateResult>}
 */
const markNotificationTriggered = async (requestId) => {
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('markNotificationTriggered: requestId is required');
  }

  return Group.updateOne(
    { 'advisorRequest.requestId': requestId },
    {
      $set: {
        'advisorRequest.notificationTriggered': true,
        'advisorRequest.updatedAt': new Date(),
      },
    }
  );
};

module.exports = {
  markNotificationTriggered,
};
