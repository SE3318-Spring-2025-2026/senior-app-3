/**
 * Migration: 004_add_operation_type_to_schedule_windows
 *
 * Adds operationType field to the schedulewindows collection to support
 * per-operation-type schedule boundaries (group_creation, member_addition).
 *
 * Any pre-existing windows without operationType are migrated to
 * 'group_creation' since the original ScheduleWindow model only enforced
 * group creation boundaries.
 *
 * Also adds a compound index: { operationType, isActive, startsAt, endsAt }
 * used by the checkScheduleWindow middleware.
 */

module.exports = {
  name: '004_add_operation_type_to_schedule_windows',

  up: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'schedulewindows' }).toArray();
    if (collections.length === 0) {
      await conn.createCollection('schedulewindows');
      console.log('[MIGRATION] Created schedulewindows collection');
    }

    const coll = conn.collection('schedulewindows');

    // Backfill existing documents that lack operationType
    const result = await coll.updateMany(
      { operationType: { $exists: false } },
      { $set: { operationType: 'group_creation' } }
    );
    console.log(`[MIGRATION] Backfilled operationType on ${result.modifiedCount} schedulewindow document(s)`);

    // Add compound index for boundary check queries
    await coll.createIndex(
      { operationType: 1, isActive: 1, startsAt: 1, endsAt: 1 },
    );
    console.log('[MIGRATION] Ensured index: schedulewindows.(operationType, isActive, startsAt, endsAt)');
  },

  down: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'schedulewindows' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] schedulewindows collection does not exist, skipping rollback');
      return;
    }

    const coll = conn.collection('schedulewindows');

    await coll.updateMany(
      {},
      { $unset: { operationType: '' } }
    );
    console.log('[MIGRATION] Removed operationType field from all schedulewindow documents');

    try {
      await coll.dropIndex('operationType_1_isActive_1_startsAt_1_endsAt_1');
      console.log('[MIGRATION] Dropped compound operationType index');
    } catch (err) {
      console.log('[MIGRATION] Index not found, skipping drop:', err.message);
    }
  },
};
