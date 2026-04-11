const { v4: uuidv4 } = require('uuid');
const AdvisorRequest = require('../models/AdvisorRequest');
const Group = require('../models/Group');
const User = require('../models/User');
const { createAuditLog } = require('../services/auditService');
const { AUDIT_ACTIONS } = require('../utils/operationTypes');
const { 
  dispatchAdvisorRequestNotification, 
  dispatchAdvisorDecisionNotification, 
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification
} = require('../services/notificationService');

/**
 * GET /api/v1/advisor-requests/pending
 * 
 * List all pending advisor requests for the authenticated professor.
 */
const listProfessorPendingRequests = async (req, res) => {
  try {
    const professorId = req.user.userId;
    const requests = await AdvisorRequest.find({
      professorId,
      status: 'pending',
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      requests: requests.map((item) => ({
        requestId: item.requestId,
        groupId: item.groupId,
        professorId: item.professorId,
        requesterId: item.createdBy,
        status: item.status,
        message: item.reason || '',
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    console.error('listProfessorPendingRequests error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

/**
 * POST /api/v1/advisor-requests
 * 
 * Student (leader) submits a request for a professor to become their advisor.
 */
const createAdvisorRequest = async (req, res) => {
  try {
    const { groupId, professorId } = req.body;
    const actorId = req.user.userId;

    // Validate group and ownership
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== actorId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the group leader can request an advisor' });
    }

    // 409: Group already has advisor
    if (group.advisorStatus === 'assigned' || group.professorId) {
      return res.status(409).json({ code: 'GROUP_ALREADY_HAS_ADVISOR', message: 'This group already has an assigned advisor' });
    }

    // 409: Group already has pending request
    const existingPending = await AdvisorRequest.findOne({ groupId, status: 'pending' });
    if (existingPending) {
      return res.status(409).json({ code: 'DUPLICATE_REQUEST', message: 'A pending advisor request already exists for this group' });
    }

    // Validate professor exists
    const professor = await User.findOne({ userId: professorId, role: 'professor' });
    if (!professor) {
      return res.status(404).json({ code: 'PROFESSOR_NOT_FOUND', message: 'Professor not found' });
    }

    const requestId = `arq_${uuidv4().split('-')[0]}`;
    const advisorRequest = await AdvisorRequest.create({
      requestId,
      groupId,
      professorId,
      createdBy: actorId,
      status: 'pending'
    });

    // Update group advisor status
    group.advisorStatus = 'pending';
    await group.save();

    await dispatchAdvisorRequestNotification({ groupId, professorId });

    await createAuditLog({
      action: AUDIT_ACTIONS.ADVISOR_REQUEST_SUBMITTED,
      actorId,
      groupId,
      targetId: requestId,
      payload: { professorId }
    });

    res.status(201).json({ requestId, message: 'Advisor request submitted', notificationTriggered: true });
  } catch (error) {
    console.error('Error creating advisor request:', error);
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * PATCH /api/v1/advisor-requests/:requestId
 * 
 * Professor approves or rejects an advisor request.
 */
const decideAdvisorRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;
    const actorId = req.user.userId;

    const advisorRequest = await AdvisorRequest.findOne({ requestId });
    if (!advisorRequest) {
      return res.status(404).json({ code: 'REQUEST_NOT_FOUND', message: 'Advisor request not found' });
    }

    // RBAC: Only the targeted professor can decide
    if (advisorRequest.professorId !== actorId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the assigned professor can decide on this request' });
    }

    // 409: Already processed
    if (advisorRequest.status !== 'pending') {
      return res.status(409).json({ code: 'ALREADY_PROCESSED', message: 'This request has already been decided' });
    }

    const isApprove = decision === 'approve';
    advisorRequest.status = isApprove ? 'approved' : 'rejected';
    advisorRequest.reason = reason || null;
    await advisorRequest.save();

    const group = await Group.findOne({ groupId: advisorRequest.groupId });
    if (group) {
      if (isApprove) {
        group.advisorStatus = 'assigned';
        group.professorId = actorId;
        group.advisorId = actorId;
      } else {
        group.advisorStatus = 'pending'; 
        group.professorId = null;
        group.advisorId = null;
      }
      await group.save();
    }

    await dispatchAdvisorDecisionNotification({ 
      groupId: advisorRequest.groupId, 
      professorId: actorId, 
      decision 
    });

    await createAuditLog({
      action: isApprove ? AUDIT_ACTIONS.ADVISOR_APPROVED : AUDIT_ACTIONS.ADVISOR_REJECTED,
      actorId,
      groupId: advisorRequest.groupId,
      targetId: requestId,
      payload: !isApprove ? { reason } : null
    });

    res.status(200).json({ 
      message: `Advisor request ${decision}d`,
      assignedGroupId: isApprove ? advisorRequest.groupId : null
    });
  } catch (error) {
    console.error('Error deciding advisor request:', error);
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * DELETE /api/v1/groups/:groupId/advisor
 * 
 * Release an advisor from a group.
 */
const releaseAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const actorId = req.user.userId;

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    // RBAC: Only Leader or Coordinator
    if (group.leaderId !== actorId && req.user.role !== 'coordinator') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the group leader or coordinator can release an advisor' });
    }

    // 409: No current advisor
    if (group.advisorStatus === 'none' && !group.professorId) {
      return res.status(409).json({ code: 'NO_ADVISOR', message: 'This group does not have an assigned advisor' });
    }

    const oldProfessorId = group.professorId;
    group.professorId = null;
    group.advisorId = null;
    group.advisorStatus = 'none'; 
    await group.save();

    await createAuditLog({
      action: AUDIT_ACTIONS.ADVISOR_RELEASED,
      actorId,
      groupId,
      payload: { oldProfessorId }
    });

    res.status(200).json({ message: 'Advisor released' });
  } catch (error) {
    console.error('Error releasing advisor:', error);
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * POST /api/v1/groups/:groupId/advisor/transfer
 * 
 * Coordinator transfers an advisor from one professor to another.
 */
const transferAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { targetProfessorId } = req.body;
    const actorId = req.user.userId;

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    // 409: Target professor conflict (already the advisor)
    if (group.professorId === targetProfessorId) {
      return res.status(409).json({ code: 'TARGET_PROFESSOR_CONFLICT', message: 'The target professor is already the advisor for this group' });
    }

    const oldProfessorId = group.professorId;
    group.professorId = targetProfessorId;
    group.advisorId = targetProfessorId;
    group.advisorStatus = 'assigned';
    await group.save();

    await dispatchAdvisorTransferNotification({ 
      groupId, 
      oldProfessorId, 
      newProfessorId: targetProfessorId 
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.ADVISOR_TRANSFERRED,
      actorId,
      groupId,
      payload: { oldProfessorId, newProfessorId: targetProfessorId }
    });

    res.status(200).json({ message: 'Advisor transferred' });
  } catch (error) {
    console.error('Error transferring advisor:', error);
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * POST /api/v1/groups/advisor-sanitization
 * 
 * Cleanup orphaned advisor requests or inconsistent group states.
 */
const advisorSanitization = async (req, res) => {
  try {
    const actorId = req.user.userId;
    
    // Check if after deadline (stub for now, but returning 409 if before is required)
    const deadlinePassed = true; 
    if (!deadlinePassed) {
      return res.status(409).json({ code: 'BEFORE_DEADLINE', message: 'Sanitization cannot run before the deadline' });
    }

    // Process: Find all groups without an advisor and disband them
    const groupsToDisband = await Group.find({ 
      $or: [
        { advisorStatus: 'none' },
        { advisorStatus: 'pending' },
        { professorId: null }
      ]
    });

    const disbandedGroupIds = [];
    for (const group of groupsToDisband) {
      group.status = 'rejected'; // Disbanding moves them to the terminal state
      await group.save();
      disbandedGroupIds.push(group.groupId);

      await dispatchGroupDisbandNotification({ groupId: group.groupId, reason: 'No advisor assigned before deadline' });

      await createAuditLog({
        action: 'group_disbanded',
        actorId,
        groupId: group.groupId,
        payload: { reason: 'sanitization' }
      });
    }

    res.status(200).json({ disbandedGroups: disbandedGroupIds });
  } catch (error) {
    console.error('Error during advisor sanitization:', error);
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

module.exports = {
  listProfessorPendingRequests,
  createAdvisorRequest,
  decideAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  advisorSanitization
};
