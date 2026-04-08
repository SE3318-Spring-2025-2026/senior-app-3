const AdvisorRequest = require('../models/AdvisorRequest');
const Group = require('../models/Group');
const User = require('../models/User');

/**
 * Process 3.2: Validate and store advisee request
 * 
 * Logic:
 * - Verify group exists and has no advisor assigned (409 if already assigned)
 * - Prevent duplicate pending requests for the same group (409)
 * - Verify professor exists and has the role 'professor'
 * - Store request to D3 (Advisor Requests)
 */
const submitRequest = async (data) => {
  const { groupId, professorId, requesterId, message } = data;

  // 1. Verify group exists and advisor assignment status
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found' };
  }

  if (group.advisorId) {
    throw { status: 409, code: 'ALREADY_HAS_ADVISOR', message: 'This group already has an assigned advisor.' };
  }

  // 2. Check for duplicate pending request
  const existingRequest = await AdvisorRequest.findOne({
    groupId,
    status: 'pending'
  });

  if (existingRequest) {
    throw { status: 409, code: 'PENDING_REQUEST_EXISTS', message: 'Group already has a pending advisor request.' };
  }

  // 3. Verify professor exists and role
  const professor = await User.findOne({ userId: professorId, role: 'professor' });
  if (!professor) {
    throw { status: 404, code: 'PROFESSOR_NOT_FOUND', message: 'Selected professor not found or invalid role.' };
  }

  // 4. Store the request (Process 3.2 → D3)
  const advisorRequest = new AdvisorRequest({
    groupId,
    professorId,
    requesterId,
    message,
    notificationTriggered: true // Placeholder for Process 3.3
  });

  await advisorRequest.save();

  return advisorRequest;
};

module.exports = {
  submitRequest
};
