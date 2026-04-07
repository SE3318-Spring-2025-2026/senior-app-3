const AuditLog = require('../models/AuditLog');

/**
 * GET /api/v1/audit-logs
 *
 * Read-only query endpoint for audit log entries.
 * Supports filtering by group_id and/or event_type.
 * Append-only guarantee: no write, update, or delete endpoints exist.
 *
 * Query params:
 *   group_id   - Filter by groupId (required for non-admin callers unless event_type supplied)
 *   event_type - Filter by action/event type
 *   limit      - Max results (default 100, max 500)
 *   offset     - Skip N results for pagination
 */
const getAuditLogs = async (req, res) => {
  try {
    const { group_id, event_type, limit: limitParam, offset: offsetParam } = req.query;

    if (!group_id && !event_type) {
      return res.status(400).json({
        code: 'MISSING_FILTER',
        message: 'At least one of group_id or event_type is required',
      });
    }

    const limit = Math.min(parseInt(limitParam, 10) || 100, 500);
    const offset = parseInt(offsetParam, 10) || 0;

    const filter = {};
    if (group_id) filter.groupId = group_id;
    if (event_type) filter.action = event_type;

    const [entries, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      total,
      limit,
      offset,
      entries: entries.map((e) => ({
        event_id: e.auditId,
        event_type: e.action,
        actor_id: e.actorId,
        group_id: e.groupId,
        target_id: e.targetId,
        payload: e.payload,
        timestamp: e.timestamp || e.createdAt,
      })),
    });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { getAuditLogs };
