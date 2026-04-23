'use strict';

const RECENT_TRIGGER_WINDOW_MS = 30 * 1000;
const triggerLedger = new Map();

const checkJiraSyncRateLimit = (req, res, next) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || req.headers['x-service-auth'] || 'anonymous';
  const key = `${groupId}:${sprintId}:${actorId}`;
  const now = Date.now();
  const previous = triggerLedger.get(key);

  if (previous && now - previous < RECENT_TRIGGER_WINDOW_MS) {
    return res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'JIRA sync was triggered too recently for this sprint. Please wait before retrying.',
      retryAfterSeconds: Math.ceil((RECENT_TRIGGER_WINDOW_MS - (now - previous)) / 1000),
    });
  }

  triggerLedger.set(key, now);

  if (triggerLedger.size > 500) {
    for (const [ledgerKey, ts] of triggerLedger.entries()) {
      if (now - ts > RECENT_TRIGGER_WINDOW_MS) {
        triggerLedger.delete(ledgerKey);
      }
    }
  }

  return next();
};

module.exports = { checkJiraSyncRateLimit };
