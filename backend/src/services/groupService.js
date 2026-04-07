/**
 * Group Service — Process 2.5 forwarding (DFD flow f03: 2.2 → 2.5)
 *
 * After Process 2.2 validates and writes the group record to D2,
 * the validated group data is forwarded to Process 2.5 (member request
 * processing pipeline). This service initialises the member list by
 * adding the leader as the first confirmed member, making the group
 * ready to receive further membership requests.
 */

const { activateGroup } = require('./groupStatusTransition');

/**
 * Forward validated group data to the member request processing pipeline.
 * Adds the leader as an accepted member (initial state for Process 2.5).
 *
 * After this function completes, the group can optionally transition to
 * ACTIVE status once validation + processing is complete (Issue #52).
 *
 * @param {object} group - Mongoose Group document (already saved to D2)
 * @returns {object} Updated group document
 */
const forwardToMemberRequestPipeline = async (group) => {
  const leaderAlreadyAdded = group.members.some((m) => m.userId === group.leaderId);

  if (!leaderAlreadyAdded) {
    group.members.push({
      userId: group.leaderId,
      role: 'leader',
      status: 'accepted',
      joinedAt: new Date(),
    });
    await group.save();
  }

  return group;
};

/**
 * Forward override confirmation to process 2.5 for reconciliation.
 * (DFD flow f17: 2.8 → 2.5)
 *
 * @param {object} override - Mongoose Override document (already saved to D2)
 * @returns {object} Updated override document
 */
const forwardOverrideToReconciliation = async (override) => {
  override.status = 'reconciled';
  override.reconciledAt = new Date();
  await override.save();
  return override;
};

module.exports = {
  forwardToMemberRequestPipeline,
  forwardOverrideToReconciliation,
  // Issue #52: Export transition functions for group lifecycle management
  activateGroup,
};
