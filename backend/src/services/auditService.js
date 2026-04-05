const AuditLog = require('../models/AuditLog');

/**
 * Record an audit event.
 *
 * @param {object} params
 * @param {string} params.action      - One of ACCOUNT_CREATED | ACCOUNT_RETRIEVED | ACCOUNT_UPDATED
 * @param {string} params.actorId     - userId of the requester performing the action
 * @param {string} params.targetId    - userId of the account being acted upon
 * @param {object} [params.changes]   - For ACCOUNT_UPDATED: { previous, updated }
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [session]          - Mongoose session for transactional writes
 */
const createAuditLog = async (
  { action, actorId, targetId, changes = null, ipAddress = null, userAgent = null },
  session = null
) => {
  const log = new AuditLog({ action, actorId, targetId, changes, ipAddress, userAgent });
  await log.save(session ? { session } : undefined);
  return log;
};

module.exports = { createAuditLog };
