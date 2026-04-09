/**
 * Migration: 006_add_advisor_assignment_fields_to_groups
 *
 * Adds advisor assignment and tracking fields to the groups collection for Issue #68:
 * - advisorStatus: status of advisor assignment (pending/assigned/released/transferred/disbanded)
 * - advisorRequestId: reference to the advisor request record
 * - advisorRequest: embedded sub-document containing:
 *   - requestId: unique identifier for the advisor request
 *   - groupId: reference to the group
 *   - professorId: the professor being requested as advisor
 *   - requesterId: the user who submitted the request
 *   - status: request status (pending/approved/rejected)
 *   - message: optional message with the request
 *   - notificationTriggered: flag indicating if notification was sent
 *   - createdAt: timestamp of request creation
 * - advisorUpdatedAt: timestamp of last advisor assignment update
 *
 * Also creates indexes on advisorId, advisorStatus for performance and conflict detection.
 * Migration is idempotent and reversible.
 */

module.exports = {
  name: '006_add_advisor_assignment_fields_to_groups',

  up: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'groups' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] groups collection does not exist, skipping migration');
      return;
    }

    const coll = conn.collection('groups');

    // Check if fields already exist (idempotent)
    const sampleDoc = await coll.findOne({});
    const fieldsExist = sampleDoc && (
      sampleDoc.hasOwnProperty('advisorStatus') ||
      sampleDoc.hasOwnProperty('advisorRequestId') ||
      sampleDoc.hasOwnProperty('advisorRequest')
    );

    if (fieldsExist) {
      console.log('[MIGRATION] Advisor assignment fields already exist, skipping migration');
      return;
    }

    // Backfill existing documents with advisor assignment fields
    const result = await coll.updateMany(
      {},
      {
        $set: {
          advisorStatus: null,
          advisorRequestId: null,
          advisorRequest: null,
          advisorUpdatedAt: null,
        },
      }
    );
    console.log(
      `[MIGRATION] Backfilled advisor assignment fields on ${result.modifiedCount} group document(s)`
    );

    // Create indexes for advisor assignment queries and conflict detection
    await coll.createIndex({ advisorId: 1 });
    console.log('[MIGRATION] Ensured index: groups.advisorId');

    await coll.createIndex({ advisorStatus: 1 });
    console.log('[MIGRATION] Ensured index: groups.advisorStatus');

    // Index on advisorRequestId for fast request lookups
    await coll.createIndex({ 'advisorRequest.requestId': 1 });
    console.log('[MIGRATION] Ensured index: groups.advisorRequest.requestId');

    // Compound index for filtering groups by advisor and status
    await coll.createIndex({ advisorId: 1, advisorStatus: 1 });
    console.log('[MIGRATION] Ensured compound index: groups.advisorId.advisorStatus');
  },

  down: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'groups' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] groups collection does not exist, skipping rollback');
      return;
    }

    const coll = conn.collection('groups');

    // Remove the added advisor assignment fields
    const result = await coll.updateMany(
      {},
      {
        $unset: {
          advisorStatus: '',
          advisorRequestId: '',
          advisorRequest: '',
          advisorUpdatedAt: '',
        },
      }
    );
    console.log(
      `[MIGRATION] Removed advisor assignment fields from ${result.modifiedCount} group document(s)`
    );

    // Drop indexes
    const indexesToDrop = [
      'advisorId_1',
      'advisorStatus_1',
      'advisorRequest.requestId_1',
      'advisorId_1_advisorStatus_1',
    ];

    for (const indexName of indexesToDrop) {
      try {
        await coll.dropIndex(indexName);
        console.log(`[MIGRATION] Dropped index: groups.${indexName}`);
      } catch (err) {
        if (!err.message.includes('index not found')) {
          throw err;
        }
      }
    }
  },
};
