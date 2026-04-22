'use strict';

const { createAuditLog } = require('./auditService');

const REQUIRED_GITHUB_SCOPES = ['repo:status', 'read:org'];

function parseScopes(scopeHeader) {
  if (!scopeHeader || typeof scopeHeader !== 'string') return [];
  return scopeHeader
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function missingScopes(grantedScopes) {
  const grantedSet = new Set(grantedScopes);
  return REQUIRED_GITHUB_SCOPES.filter((scope) => !grantedSet.has(scope));
}

function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '****';
  if (secret.length <= 4) return '****';
  return `${secret.slice(0, 3)}****${secret.slice(-2)}`;
}

async function logSecurityAudit({
  actorId = null,
  groupId = null,
  targetId = null,
  reason,
  provider,
  statusCode,
  req,
}) {
  await createAuditLog({
    action: 'SECURITY_AUDIT',
    actorId,
    groupId,
    targetId,
    payload: {
      reason,
      provider,
      statusCode,
      path: req?.originalUrl || null,
      method: req?.method || null,
      correlationId: req?.headers?.['x-correlation-id'] || null,
    },
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
  });
}

module.exports = {
  REQUIRED_GITHUB_SCOPES,
  parseScopes,
  missingScopes,
  maskSecret,
  logSecurityAudit,
};
