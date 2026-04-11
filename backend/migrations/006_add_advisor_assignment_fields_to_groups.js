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

    // FIX #1: MIGRATION IDEMPOTENCY
    // DEFICIENCY: Sample doc check prevents partial migrations from completing
    // PROBLEM: If ANY document has ANY advisor field, the entire backfill is skipped,
    //          leaving other documents without advisor fields (inconsistent state)
    // SOLUTION: Use $exists: false filters to only update documents missing each field
    // This allows the migration to complete safely even if run multiple times
    // Each field is backfilled independently with proper conflict prevention

    // Backfill advisorStatus on documents that don't have it
    const resultStatus = await coll.updateMany(
      { advisorStatus: { $exists: false } },
      { $set: { advisorStatus: null } }
    );
    console.log(
      `[MIGRATION] Backfilled advisorStatus on ${resultStatus.modifiedCount} group document(s)`
    );

    // Backfill advisorRequestId on documents that don't have it
    const resultRequestId = await coll.updateMany(
      { advisorRequestId: { $exists: false } },
      { $set: { advisorRequestId: null } }
    );
    console.log(
      `[MIGRATION] Backfilled advisorRequestId on ${resultRequestId.modifiedCount} group document(s)`
    );

    // Backfill advisorRequest on documents that don't have it
    const resultRequest = await coll.updateMany(
      { advisorRequest: { $exists: false } },
      { $set: { advisorRequest: null } }
    );
    console.log(
      `[MIGRATION] Backfilled advisorRequest on ${resultRequest.modifiedCount} group document(s)`
    );

    // Backfill advisorUpdatedAt on documents that don't have it
    const result = await coll.updateMany(
      { advisorUpdatedAt: { $exists: false } },
      { $set: { advisorUpdatedAt: null } }
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
