const AuditLog = require('../models/AuditLog');

/**
 * Record an audit event.
 *
 * @param {object} params
 * @param {string} params.action      - One of the AuditLog action enum values
 * @param {string} [params.actorId]   - userId of the requester performing the action
 * @param {string} [params.targetId]  - userId or entityId of the subject being acted upon
 * @param {string} [params.groupId]   - groupId for group formation events (issue spec: group_id)
 * @param {object} [params.payload]   - Event-specific data (issue spec: payload{})
 * @param {object} [params.changes]   - For ACCOUNT_UPDATED: { previous, updated }
 * @param {object} [params.details]   - Additional details for the action
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [session]          - Mongoose session for transactional writes
 */
const createAuditLog = async (
  {
    action,
    actorId = null,
    targetId = null,
    groupId = null,
    payload = null,
    changes = null,
    details = null,
    ipAddress = null,
    userAgent = null,
    correlationId = null,
  },
  session = null
) => {
  const log = new AuditLog({
    action,
    actorId,
    targetId,
    groupId,
    payload,
    changes,
    details,
    ipAddress,
    userAgent,
    correlationId,
  });
  await log.save(session ? { session } : undefined);
  return log;
};

module.exports = { createAuditLog };
