/**
 * ============================================================================
 * Migration #011: Issue #237 Sprint Persistence Models — D6/D4 Collections
 * ============================================================================
 *
 * CHANGES FOR ISSUE #237:
 * - Creates SprintContributionRecord collection (D6) for per-student records
 * - Creates SprintReportingRecord collection (D4) for aggregate reporting
 * - Establishes compound indexes for efficient querying
 * - Sets up idempotent key constraints
 * - Adds finalization lock support
 * - Adds D4→D6 reconciliation fields
 *
 * DATABASE CHANGES:
 * 1. sprintcontributionrecords collection (NEW)
 *    - Stores per-student contribution snapshots
 *    - Compound unique index: (sprintId, studentId, groupId)
 *    - Supports atomic upsert operations
 *    - Includes finalization lock fields
 *
 * 2. sprintreportingrecords collection (NEW)
 *    - Stores aggregate metrics for coordinator dashboards
 *    - Compound unique index: (sprintId, groupId)
 *    - Links to D6 canonical data
 *    - Supports reconciliation status tracking
 *
 * DFD INTEGRATION:
 * - D6 (sprintcontributionrecords): Canonical contribution storage
 * - D4 (sprintreportingrecords): Reporting metadata for Flow 128
 * - D4→D6 Sync (Flow 139): Reconciliation via consistency checks
 *
 * EXECUTION:
 * This migration is idempotent — safe to run multiple times
 */

module.exports = {
  name: '011_create_sprint_persistence_models',

  /**
   * ISSUE #237: Create collections and indexes for D6/D4 persistence
   */
  up: async (db) => {
    try {
      // ───────────────────────────────────────────────────────────────────────
      // STEP 1: CREATE SprintContributionRecord COLLECTION (D6)
      // ISSUE #237: Canonical storage for per-student contributions
      // ───────────────────────────────────────────────────────────────────────
      console.log('[MIGRATION #011] Creating sprintcontributionrecords collection...');

      const sprintContribCollections = await db.connection.db
        .listCollections({ name: 'sprintcontributionrecords' })
        .toArray();

      if (sprintContribCollections.length === 0) {
        await db.connection.db.createCollection('sprintcontributionrecords');
        console.log('[MIGRATION #011] ✓ Created sprintcontributionrecords collection');
      } else {
        console.log('[MIGRATION #011] ⊙ sprintcontributionrecords collection already exists');
      }

      const sprintContribCollection = db.connection.db.collection('sprintcontributionrecords');

      // ISSUE #237: Index 1 — Primary key uniqueness
      // Used for atomic upsert: (sprintId, studentId, groupId)
      try {
        await sprintContribCollection.createIndex(
          { sprintId: 1, studentId: 1, groupId: 1 },
          { unique: true, sparse: true, background: true }
        );
        console.log('[MIGRATION #011] ✓ Created compound index (sprintId, studentId, groupId)');
      } catch (err) {
        if (err.code === 85) {
          // Index already exists with different options
          console.log('[MIGRATION #011] ⊙ Index (sprintId, studentId, groupId) already exists');
        } else {
          throw err;
        }
      }

      // ISSUE #237: Index 2 — Lookup all contributions for a sprint
      // Used by D4→D6 reconciliation (Flow 139)
      try {
        await sprintContribCollection.createIndex(
          { sprintId: 1, groupId: 1 },
          { background: true }
        );
        console.log('[MIGRATION #011] ✓ Created index (sprintId, groupId)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (sprintId, groupId) already exists');
        } else {
          throw err;
        }
      }

      // ISSUE #237: Index 3 — Finalized sprints query
      // Used for checking 409 conflicts
      try {
        await sprintContribCollection.createIndex(
          { sprintId: 1, isFinalized: 1 },
          { background: true }
        );
        console.log('[MIGRATION #011] ✓ Created index (sprintId, isFinalized)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (sprintId, isFinalized) already exists');
        } else {
          throw err;
        }
      }

      // ISSUE #237: Index 4 — Coordinator audit queries
      try {
        await sprintContribCollection.createIndex(
          { lastCalculatedBy: 1, lastCalculationAt: 1 },
          { background: true }
        );
        console.log('[MIGRATION #011] ✓ Created index (lastCalculatedBy, lastCalculationAt)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (lastCalculatedBy, lastCalculationAt) already exists');
        } else {
          throw err;
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // STEP 2: CREATE SprintReportingRecord COLLECTION (D4)
      // ISSUE #237: Reporting metadata for coordinator visibility (Flow 128)
      // ───────────────────────────────────────────────────────────────────────
      console.log('[MIGRATION #011] Creating sprintreportingrecords collection...');

      const sprintReportCollections = await db.connection.db
        .listCollections({ name: 'sprintreportingrecords' })
        .toArray();

      if (sprintReportCollections.length === 0) {
        await db.connection.db.createCollection('sprintreportingrecords');
        console.log('[MIGRATION #011] ✓ Created sprintreportingrecords collection');
      } else {
        console.log('[MIGRATION #011] ⊙ sprintreportingrecords collection already exists');
      }

      const sprintReportCollection = db.connection.db.collection('sprintreportingrecords');

      // ISSUE #237: Index 1 — Primary lookup by sprint + group
      // Used for D4→D6 reconciliation (Flow 139)
      try {
        await sprintReportCollection.createIndex(
          { sprintId: 1, groupId: 1 },
          { unique: true, sparse: true, background: true }
        );
        console.log('[MIGRATION #011] ✓ Created compound index (sprintId, groupId)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (sprintId, groupId) already exists');
        } else {
          throw err;
        }
      }

      // ISSUE #237: Index 2 — Coordinator's reporting records
      try {
        await sprintReportCollection.createIndex(
          { coordinatorId: 1, calculatedAt: -1 },
          { background: true }
        );
        console.log('[MIGRATION #011] ✓ Created index (coordinatorId, calculatedAt)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (coordinatorId, calculatedAt) already exists');
        } else {
          throw err;
        }
      }

      // ISSUE #237: Index 3 — Reconciliation status queries
      // Used to find records needing verification
      try {
        await sprintReportCollection.createIndex(
          { reconciliationStatus: 1, lastReconciledAt: 1 },
          { background: true }
        );
        console.log('[MIGRATION #011] ✓ Created index (reconciliationStatus, lastReconciledAt)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (reconciliationStatus, lastReconciledAt) already exists');
        } else {
          throw err;
        }
      }

      // ISSUE #237: Index 4 — Active records (soft delete support)
      try {
        await sprintReportCollection.createIndex(
          { groupId: 1, deletedAt: 1 },
          { background: true }
        );
        console.log('[MIGRATION #011] ✓ Created index (groupId, deletedAt)');
      } catch (err) {
        if (err.code === 85) {
          console.log('[MIGRATION #011] ⊙ Index (groupId, deletedAt) already exists');
        } else {
          throw err;
        }
      }

      console.log('[MIGRATION #011] ✅ All collections and indexes created successfully');
    } catch (error) {
      console.error('[MIGRATION #011] ERROR:', error);
      throw error;
    }
  },

  /**
   * ISSUE #237: Rollback — Remove collections
   * WARNING: This destructively deletes all data in these collections
   */
  down: async (db) => {
    try {
      console.log('[MIGRATION #011 ROLLBACK] Removing sprintcontributionrecords collection...');
      try {
        await db.connection.db.dropCollection('sprintcontributionrecords');
        console.log('[MIGRATION #011 ROLLBACK] ✓ Dropped sprintcontributionrecords');
      } catch (err) {
        if (err.code === 26) {
          // Collection doesn't exist
          console.log('[MIGRATION #011 ROLLBACK] ⊙ sprintcontributionrecords not found');
        } else {
          throw err;
        }
      }

      console.log('[MIGRATION #011 ROLLBACK] Removing sprintreportingrecords collection...');
      try {
        await db.connection.db.dropCollection('sprintreportingrecords');
        console.log('[MIGRATION #011 ROLLBACK] ✓ Dropped sprintreportingrecords');
      } catch (err) {
        if (err.code === 26) {
          // Collection doesn't exist
          console.log('[MIGRATION #011 ROLLBACK] ⊙ sprintreportingrecords not found');
        } else {
          throw err;
        }
      }

      console.log('[MIGRATION #011 ROLLBACK] ✅ Rollback completed');
    } catch (error) {
      console.error('[MIGRATION #011 ROLLBACK] ERROR:', error);
      throw error;
    }
  },
};
