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
 * After this function completes, the group automatically transitions to
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

  // Issue #52: Automatically activate group after member request pipeline processing
  try {
    const updatedGroup = await activateGroup(group.groupId, {
      actorId: group.leaderId, // System-triggered by leader setup
      reason: 'Automatic activation after validation and member request pipeline processing',
      ipAddress: null,
      userAgent: null,
    });
    return updatedGroup;
  } catch (err) {
    console.warn(`Auto-activation failed for group ${group.groupId}:`, err.message);
    // Return original group if activation fails; pipeline continues
    return group;
  }
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

/**
 * Issue #66: Validate schedule window for advisor association operations
 * 
 * Checks if the current time falls within the configured open_at and close_at
 * window for the advisor_association operation type.
 * 
 * @param {string} operationType - Operation type (e.g., 'advisor_association')
 * @returns {Promise} { isOpen: boolean, message: string, window: { open_at, close_at } }
 */
const validateScheduleWindow = async (operationType = 'advisor_association') => {
  const ScheduleWindow = require('../models/ScheduleWindow');
  
  try {
    const window = await ScheduleWindow.findOne({ operation_type: operationType });
    
    if (!window) {
      // No schedule configured, assume open
      return {
        isOpen: true,
        message: 'No schedule window configured',
        window: null,
      };
    }
    
    const now = new Date();
    const openAt = new Date(window.open_at);
    const closeAt = new Date(window.close_at);
    
    const isOpen = now >= openAt && now <= closeAt;
    
    return {
      isOpen,
      message: isOpen 
        ? `Schedule window is open (${openAt.toISOString()} to ${closeAt.toISOString()})`
        : `Schedule window is closed. Opens at ${openAt.toISOString()}, closes at ${closeAt.toISOString()}`,
      window: {
        open_at: openAt,
        close_at: closeAt,
      },
    };
  } catch (error) {
    console.error('Error checking schedule window:', error);
    throw error;
  }
};

module.exports = {
  forwardToMemberRequestPipeline,
  forwardOverrideToReconciliation,
  // Issue #52: Export transition functions for group lifecycle management
  activateGroup,
  // Issue #66: Schedule window validation for advisor association
  validateScheduleWindow,
};
