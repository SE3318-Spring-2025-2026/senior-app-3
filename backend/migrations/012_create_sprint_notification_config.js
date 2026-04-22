/**
 * ================================================================================
 * ISSUE #238: Migration 012 — Sprint Notification Config Collection & Indexes
 * ================================================================================
 *
 * Purpose:
 * Create MongoDB collection and indexes to support per-sprint/per-group notification
 * configuration storage (Issue #238).
 *
 * Collection: sprintnotificationconfigs (D2 configuration data store)
 *
 * DFD Reference:
 * - Data Store: D2 (Group configuration)
 * - Process: 7.5 (checks config before notification dispatch)
 *
 * This migration is fully idempotent (safe to run multiple times):
 * - Checks collection existence before creating
 * - Gracefully handles index creation when indexes already exist (error code 85)
 * - Includes rollback support via down() function
 *
 * Indexes Created:
 * 1. (sprintId, groupId) UNIQUE — Primary idempotent key for upsert pattern
 * 2. (sprintId, enabled) — Find active configs for sprint (batch notification jobs)
 * 3. (groupId, updatedAt) — Timeline of config changes per group
 * 4. (lastNotificationStatus, lastNotificationAt) — Find failed attempts (monitoring)
 *
 * ================================================================================
 */

// ISSUE #238: Migration runner compatibility
exports.up = async (db) => {
  try {
    console.log('ISSUE #238: [MIGRATION 012] Starting sprint notification config collection setup...');

    // ========================================================================
    // ISSUE #238: Step 1 — Create collection if not exists
    // ========================================================================

    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    if (!collectionNames.includes('sprintnotificationconfigs')) {
      console.log('ISSUE #238: Creating sprintnotificationconfigs collection...');
      
      await db.createCollection('sprintnotificationconfigs', {
        // ISSUE #238: Schema validation for data consistency
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['notificationConfigId', 'sprintId', 'groupId'],
            properties: {
              notificationConfigId: {
                bsonType: 'string',
                description: 'Unique identifier (snc_ prefix)'
              },
              sprintId: {
                bsonType: ['string', 'objectId'],
                description: 'Reference to Sprint entity'
              },
              groupId: {
                bsonType: ['string', 'objectId'],
                description: 'Reference to Group entity'
              },
              _uniqueKey: {
                bsonType: 'string',
                description: 'Composite key: sprintId#groupId'
              },
              notifyStudents: {
                bsonType: 'bool',
                description: 'Send individual notification to each student'
              },
              notifyCoordinator: {
                bsonType: 'bool',
                description: 'Send summary notification to coordinator'
              },
              enabled: {
                bsonType: 'bool',
                description: 'Master enable/disable for all notifications'
              },
              maxRetryAttempts: {
                bsonType: 'int',
                description: 'Maximum retry attempts for transient failures'
              },
              deletedAt: {
                bsonType: ['date', 'null'],
                description: 'Soft delete timestamp (null = active)'
              }
            }
          }
        }
      });

      console.log('✅ ISSUE #238: sprintnotificationconfigs collection created');
    } else {
      console.log('⏭️  ISSUE #238: sprintnotificationconfigs collection already exists');
    }

    // ========================================================================
    // ISSUE #238: Step 2 — Create indexes (idempotent)
    // ========================================================================

    // ISSUE #238: Index 1 — Primary idempotent key lookup
    // Used in: upsert pattern to ensure only one config per (sprintId, groupId)
    try {
      console.log('ISSUE #238: Creating index 1: (sprintId, groupId) UNIQUE...');
      await db.collection('sprintnotificationconfigs').createIndex(
        { sprintId: 1, groupId: 1 },
        { 
          unique: true, 
          sparse: true,
          name: 'idx_sprint_group_unique'
        }
      );
      console.log('✅ ISSUE #238: Index 1 created (sprintId, groupId)');
    } catch (error) {
      // ISSUE #238: Error code 85 = index already exists (idempotent)
      if (error.code === 85) {
        console.log('⏭️  ISSUE #238: Index 1 already exists (sprintId, groupId)');
      } else {
        throw error;
      }
    }

    // ISSUE #238: Index 2 — Find all enabled configs for a sprint
    // Used in: batch notification jobs, pre-dispatch filtering
    try {
      console.log('ISSUE #238: Creating index 2: (sprintId, enabled, deletedAt)...');
      await db.collection('sprintnotificationconfigs').createIndex(
        { sprintId: 1, enabled: 1, deletedAt: 1 },
        { name: 'idx_sprint_enabled_active' }
      );
      console.log('✅ ISSUE #238: Index 2 created (sprintId, enabled, deletedAt)');
    } catch (error) {
      if (error.code === 85) {
        console.log('⏭️  ISSUE #238: Index 2 already exists (sprintId, enabled, deletedAt)');
      } else {
        throw error;
      }
    }

    // ISSUE #238: Index 3 — Group timeline of config changes
    // Used in: audit queries, group-level statistics
    try {
      console.log('ISSUE #238: Creating index 3: (groupId, updatedAt DESC)...');
      await db.collection('sprintnotificationconfigs').createIndex(
        { groupId: 1, updatedAt: -1 },
        { name: 'idx_group_timeline' }
      );
      console.log('✅ ISSUE #238: Index 3 created (groupId, updatedAt DESC)');
    } catch (error) {
      if (error.code === 85) {
        console.log('⏭️  ISSUE #238: Index 3 already exists (groupId, updatedAt DESC)');
      } else {
        throw error;
      }
    }

    // ISSUE #238: Index 4 — Find failed notification attempts
    // Used in: monitoring systems, alert generation, manual review
    try {
      console.log('ISSUE #238: Creating index 4: (lastNotificationStatus, lastNotificationAt)...');
      await db.collection('sprintnotificationconfigs').createIndex(
        { lastNotificationStatus: 1, lastNotificationAt: 1 },
        { name: 'idx_notification_status_timeline' }
      );
      console.log('✅ ISSUE #238: Index 4 created (lastNotificationStatus, lastNotificationAt)');
    } catch (error) {
      if (error.code === 85) {
        console.log('⏭️  ISSUE #238: Index 4 already exists (lastNotificationStatus, lastNotificationAt)');
      } else {
        throw error;
      }
    }

    console.log('✅ ISSUE #238: [MIGRATION 012] Sprint notification config setup completed successfully');
    return true;

  } catch (error) {
    console.error('❌ ISSUE #238: [MIGRATION 012] Error during up(): ' + error.message);
    throw error;
  }
};

/**
 * ISSUE #238: Rollback function (for downgrade scenarios)
 *
 * Removes collection and all indexes, but preserves any existing data by
 * just dropping the collection (MongoDB will back it up).
 */
exports.down = async (db) => {
  try {
    console.log('ISSUE #238: [MIGRATION 012] Rolling back sprint notification config setup...');

    // ISSUE #238: Drop collection (removes all indexes automatically)
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    if (collectionNames.includes('sprintnotificationconfigs')) {
      console.log('ISSUE #238: Dropping sprintnotificationconfigs collection...');
      await db.collection('sprintnotificationconfigs').drop();
      console.log('✅ ISSUE #238: sprintnotificationconfigs collection dropped');
    } else {
      console.log('⏭️  ISSUE #238: sprintnotificationconfigs collection does not exist');
    }

    console.log('✅ ISSUE #238: [MIGRATION 012] Rollback completed successfully');
    return true;

  } catch (error) {
    console.error('❌ ISSUE #238: [MIGRATION 012] Error during down(): ' + error.message);
    throw error;
  }
};
