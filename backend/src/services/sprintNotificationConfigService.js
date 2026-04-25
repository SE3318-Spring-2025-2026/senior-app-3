/**
 * ================================================================================
 * ISSUE #238: Sprint Notification Configuration Service — CRUD & Validation
 * ================================================================================
 *
 * Purpose:
 * Manage per-sprint/per-group notification configurations. Provides methods for
 * creating, reading, updating, and deleting notification settings while enforcing
 * per-entity feature flags and validation rules.
 *
 * DFD Reference:
 * - Data Store: D2 (Group configuration) — notification config extends group settings
 * - Process: 7.5 (Sprint persistence) — notification config checked before dispatch
 *
 * Design Pattern:
 * Follows existing SprintConfig CRUD service approach for consistency.
 * Implements idempotent upsert pattern using (sprintId, groupId) composite key.
 *
 * ================================================================================
 */

const SprintNotificationConfig = require('../models/SprintNotificationConfig');
const { createAuditLog } = require('./auditService');

// ================================================================================
// ISSUE #238: CRUD OPERATIONS
// ================================================================================

/**
 * ISSUE #238: Create or update notification configuration for a sprint
 *
 * Implements idempotent upsert: if config already exists for (sprintId, groupId),
 * updates it; otherwise creates new.
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @param {Object} configData - Configuration fields to set/update
 * @param {String} coordinatorId - Who is making this change (for audit)
 * @returns {Promise<Object>} Created/updated configuration
 */
async function upsertNotificationConfig(sprintId, groupId, configData, coordinatorId) {
  try {
    // ISSUE #238: Use findOneAndUpdate for idempotent upsert
    const config = await SprintNotificationConfig.findOneAndUpdate(
      {
        sprintId,
        groupId,
        deletedAt: null  // ISSUE #238: Only update active configs
      },
      {
        ...configData,
        updatedBy: coordinatorId,
        updatedAt: new Date()
      },
      {
        upsert: true,  // ISSUE #238: Create if doesn't exist
        new: true,      // ISSUE #238: Return updated document
        runValidators: true
      }
    );

    // ISSUE #238: Validate configuration after upsert
    const validation = config.isValid();
    if (!validation.isValid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }

    // ISSUE #238: Create audit log for configuration change
    await createAuditLog({
      action: 'SPRINT_GROUP_NOTIFICATION_CONFIGURED',
      actorId: coordinatorId,
      targetId: groupId,
      groupId,
      payload: {
        sprintId,
        notifyStudents: config.notifyStudents,
        notifyCoordinator: config.notifyCoordinator,
        enabled: config.enabled,
        studentDeliveryMethod: config.studentDeliveryMethod,
        coordinatorRecipientStrategy: config.coordinatorRecipientStrategy
      }
    }).catch(err => {
      // ISSUE #238: Audit logging is non-fatal
      console.error(`ISSUE #238: Failed to log notification config change: ${err.message}`);
    });

    return config;
  } catch (error) {
    console.error(`ISSUE #238: Error in upsertNotificationConfig: ${error.message}`);
    throw error;
  }
}

/**
 * ISSUE #238: Fetch notification configuration for a sprint
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @returns {Promise<Object|null>} Configuration or null if not found/deleted
 */
async function getNotificationConfig(sprintId, groupId) {
  try {
    // ISSUE #238: Use SprintNotificationConfig.findForSprint() static method
    const config = await SprintNotificationConfig.findForSprint(sprintId, groupId);
    return config;
  } catch (error) {
    console.error(`ISSUE #238: Error in getNotificationConfig: ${error.message}`);
    throw error;
  }
}

/**
 * ISSUE #238: Get all active notification configs for a sprint
 *
 * Used by: batch notification job to find all groups with notifications enabled
 *
 * @param {String} sprintId - Sprint ID
 * @returns {Promise<Array>} Array of active configurations
 */
async function getActiveConfigsForSprint(sprintId) {
  try {
    // ISSUE #238: Use findActiveForSprint static method
    const configs = await SprintNotificationConfig.findActiveForSprint(sprintId);
    return configs;
  } catch (error) {
    console.error(`ISSUE #238: Error in getActiveConfigsForSprint: ${error.message}`);
    throw error;
  }
}

/**
 * ISSUE #238: Get all notification configs for a group across all sprints
 *
 * Used by: audit/compliance queries, group-level statistics
 *
 * @param {String} groupId - Group ID
 * @returns {Promise<Array>} Array of active configurations for group
 */
async function getConfigsForGroup(groupId) {
  try {
    // ISSUE #238: Use findActiveForGroup static method
    const configs = await SprintNotificationConfig.findActiveForGroup(groupId);
    return configs;
  } catch (error) {
    console.error(`ISSUE #238: Error in getConfigsForGroup: ${error.message}`);
    throw error;
  }
}

/**
 * ISSUE #238: Soft delete notification configuration (preserve history)
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @param {String} coordinatorId - Who is deleting this config
 * @returns {Promise<Object>} Deleted configuration
 */
async function deleteNotificationConfig(sprintId, groupId, coordinatorId) {
  try {
    const config = await SprintNotificationConfig.findForSprint(sprintId, groupId);
    if (!config) {
      throw new Error(`Configuration not found for sprint ${sprintId}, group ${groupId}`);
    }

    // ISSUE #238: Soft delete via instance method
    await config.softDelete();

    // ISSUE #238: Audit the deletion
    await createAuditLog({
      action: 'SPRINT_NOTIFICATION_CONFIG_DELETED',
      actorId: coordinatorId,
      targetId: groupId,
      groupId,
      payload: {
        sprintId,
        reason: 'soft_deleted'
      }
    }).catch(err => {
      // ISSUE #238: Audit logging is non-fatal
      console.error(`ISSUE #238: Failed to log config deletion: ${err.message}`);
    });

    return config;
  } catch (error) {
    console.error(`ISSUE #238: Error in deleteNotificationConfig: ${error.message}`);
    throw error;
  }
}

// ================================================================================
// ISSUE #238: BULK OPERATIONS
// ================================================================================

/**
 * ISSUE #238: Check if notifications should be dispatched for a sprint
 *
 * Used by: pre-dispatch validation to quickly check if any group has notifications
 * enabled for a given sprint.
 *
 * @param {String} sprintId - Sprint ID
 * @returns {Promise<Boolean>} true if at least one group has notifications enabled
 */
async function hasEnabledNotificationsForSprint(sprintId) {
  try {
    // ISSUE #238: Count active configs with enabled=true
    const count = await SprintNotificationConfig.countDocuments({
      sprintId,
      enabled: true,
      deletedAt: null
    });
    return count > 0;
  } catch (error) {
    console.error(`ISSUE #238: Error in hasEnabledNotificationsForSprint: ${error.message}`);
    throw error;
  }
}

/**
 * ISSUE #238: Get all configs with failed last notification attempt
 *
 * Used by: monitoring/alert systems to find sprints needing manual review
 *
 * @param {Number} hoursAgo - Find failures from this many hours ago (default 24)
 * @returns {Promise<Array>} Configurations with failed notification status
 */
async function getFailedNotificationConfigs(hoursAgo = 24) {
  try {
    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    // ISSUE #238: Query for failure statuses since threshold
    const configs = await SprintNotificationConfig.find({
      lastNotificationStatus: { $in: ['failure', 'partial_failure'] },
      lastNotificationAt: { $gte: since },
      deletedAt: null
    })
      .sort({ lastNotificationAt: -1 })
      .lean();

    return configs;
  } catch (error) {
    console.error(`ISSUE #238: Error in getFailedNotificationConfigs: ${error.message}`);
    throw error;
  }
}

// ================================================================================
// ISSUE #238: VALIDATION & FEATURE FLAG OPERATIONS
// ================================================================================

/**
 * ISSUE #238: Validate configuration for completeness before dispatch
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @returns {Promise<Object>} { isValid: boolean, errors: string[] }
 */
async function validateConfigBeforeDispatch(sprintId, groupId) {
  try {
    const config = await SprintNotificationConfig.findForSprint(sprintId, groupId);

    if (!config) {
      // ISSUE #238: No config = use defaults (notifications enabled)
      return {
        isValid: true,
        usingDefaults: true
      };
    }

    // ISSUE #238: Check if notifications are enabled
    if (!config.isNotificationEnabled()) {
      return {
        isValid: true,
        notificationsDisabled: true
      };
    }

    // ISSUE #238: Run full validation
    return config.isValid();
  } catch (error) {
    console.error(`ISSUE #238: Error in validateConfigBeforeDispatch: ${error.message}`);
    return {
      isValid: false,
      errors: [error.message]
    };
  }
}

/**
 * ISSUE #238: Check if students should be notified for a sprint
 *
 * Quick check to avoid unnecessary processing if student notifications disabled.
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @returns {Promise<Boolean>} true if student notifications should be sent
 */
async function shouldNotifyStudents(sprintId, groupId) {
  try {
    const config = await SprintNotificationConfig.findForSprint(sprintId, groupId);

    if (!config) {
      // ISSUE #238: Default to true (notifications enabled by default)
      return true;
    }

    // ISSUE #238: Check master flag and student flag
    return config.enabled && config.notifyStudents;
  } catch (error) {
    console.error(`ISSUE #238: Error in shouldNotifyStudents: ${error.message}`);
    // ISSUE #238: On error, default to false (safe-fail: don't notify on error)
    return false;
  }
}

/**
 * ISSUE #238: Check if coordinator should be notified for a sprint
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @returns {Promise<Boolean>} true if coordinator notification should be sent
 */
async function shouldNotifyCoordinator(sprintId, groupId) {
  try {
    const config = await SprintNotificationConfig.findForSprint(sprintId, groupId);

    if (!config) {
      // ISSUE #238: Default to true (coordinator always notified)
      return true;
    }

    // ISSUE #238: Check master flag and coordinator flag
    return config.enabled && config.notifyCoordinator;
  } catch (error) {
    console.error(`ISSUE #238: Error in shouldNotifyCoordinator: ${error.message}`);
    // ISSUE #238: On error, default to true (safe-fail: notify coordinator on error)
    return true;
  }
}

// ================================================================================
// ISSUE #238: TRACKING & STATISTICS
// ================================================================================

/**
 * ISSUE #238: Get notification dispatch statistics for a sprint
 *
 * @param {String} sprintId - Sprint ID
 * @returns {Promise<Object>} Statistics: { successCount, failureCount, partialCount, avgSentCount }
 */
async function getNotificationStatsForSprint(sprintId) {
  try {
    const configs = await SprintNotificationConfig.find({
      sprintId,
      lastNotificationStatus: { $exists: true }
    }).lean();

    const stats = {
      totalConfigs: configs.length,
      successCount: configs.filter(c => c.lastNotificationStatus === 'success').length,
      failureCount: configs.filter(c => c.lastNotificationStatus === 'failure').length,
      partialCount: configs.filter(c => c.lastNotificationStatus === 'partial_failure').length,
      skippedCount: configs.filter(c => c.lastNotificationStatus === 'skipped').length,
      totalNotificationsSent: configs.reduce((sum, c) => sum + (c.notificationSentCount || 0), 0),
      avgNotificationsPerConfig: configs.length > 0
        ? Math.round(configs.reduce((sum, c) => sum + (c.notificationSentCount || 0), 0) / configs.length)
        : 0
    };

    return stats;
  } catch (error) {
    console.error(`ISSUE #238: Error in getNotificationStatsForSprint: ${error.message}`);
    throw error;
  }
}

// ================================================================================
// ISSUE #238: EXPORTS
// ================================================================================

module.exports = {
  upsertNotificationConfig,
  getNotificationConfig,
  getActiveConfigsForSprint,
  getConfigsForGroup,
  deleteNotificationConfig,
  hasEnabledNotificationsForSprint,
  getFailedNotificationConfigs,
  validateConfigBeforeDispatch,
  shouldNotifyStudents,
  shouldNotifyCoordinator,
  getNotificationStatsForSprint
};
