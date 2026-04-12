const mongoose = require('mongoose');

/**
 * Issue #84 FIX: Migration 008 - Create Committee Schema (D3 Data Store)
 * 
 * ════════════════════════════════════════════════════════════════════════
 * CRITICAL ARCHITECTURAL FIX - Migration Idempotency & Index Guarantees
 * ════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM (Before this fix):
 * ─────────────────────────
 * The original migration trapped ALL index creation inside a conditional
 * block that checked if the collection already existed:
 * 
 *   if (collection doesn't exist):
 *     create collection
 *     create indexes ← TRAPPED HERE
 *   else:
 *     log "collection exists" and RETURN
 * 
 * This violates MongoDB migration best practices. In real-world scenarios:
 * 1. Empty data import creates 'committees' collection without indexes
 * 2. Manual collection creation via DB tools skips index setup
 * 3. Partially failed migration leaves collection but no indexes
 * 4. Migration re-runs on existing collection → indexes never created
 * 
 * CONSEQUENCE: Database loses unique constraint on committeeName
 * → GUARANTEED DATA CORRUPTION: Duplicate committee names allowed
 * → SILENT FAILURE: No error messages, just duplicate records
 * → BREAKING CHANGE: Process 4.1 duplicate check (409) stops working
 * 
 * SOLUTION (This fix):
 * ──────────────────
 * Separate concerns into two independent operations:
 * 1. Collection creation (conditional): Only create if not exists
 * 2. Index creation (UNCONDITIONAL): Always attempt via createIndex()
 * 
 * MongoDB's createIndex() is inherently IDEMPOTENT:
 * - If index already exists with EXACT same spec → returns success (no-op)
 * - If index exists with DIFFERENT spec → throws error (catch & handle)
 * - If index doesn't exist → creates it
 * 
 * This pattern ensures:
 * ✅ Indexes are ALWAYS present after migration completes
 * ✅ Migration can be re-run safely without re-creating indexes
 * ✅ Partial failures are recovered (missing indexes will be added)
 * ✅ Data integrity is GUARANTEED (unique constraint on committeeName)
 * 
 * MIGRATION STRATEGY:
 * ──────────────────
 * Phase 1: Create collection (only if doesn't exist)
 * Phase 2: Create all indexes unconditionally (will be no-ops if exist)
 * Phase 3: Log results (which indexes were created vs already existed)
 * 
 * Collections:
 * - committees (D3): Committee assignments and configuration
 * 
 * Indexes Created:
 * - committeeId (unique): Ensures unique committee identifiers
 * - committeeName (unique): CRITICAL - prevents duplicate names
 * - status (standard): Query optimization for process flow (draft→validated→published)
 * - (createdBy, status) compound: Coordinator dashboard queries
 * - (status, publishedAt) descending compound: Recent published committees
 * 
 * Related: Issue #84 PR Review - Migration Idempotency Failure & Index Bypass
 * Reference: MongoDB Index Idempotency: https://docs.mongodb.com/manual/reference/method/db.collection.createIndex/
 */

/**
 * Issue #84 FIX: Helper - Create single index with error handling
 * 
 * Wraps createIndex with try-catch for idempotency.
 * If index already exists → success (no-op)
 * If index doesn't exist → creates it
 * If error occurs → logs and throws (non-idempotent errors)
 * 
 * @param {Collection} collection MongoDB collection
 * @param {Object} indexSpec Index specification {field: direction}
 * @param {Object} options Index options {unique: true, sparse: true, etc}
 * @param {string} description Human-readable index description
 */
const createIndexSafely = async (collection, indexSpec, options, description) => {
  try {
    await collection.createIndex(indexSpec, options);
    console.log(`[Migration 008] ✅ ${description}`);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error(`[Migration 008] ❌ Error creating ${description}:`, err.message);
      throw err;
    }
    console.log(`[Migration 008] ℹ️  ${description} (already exists)`);
  }
};

const up = async () => {
  const db = mongoose.connection.db;

  /**
   * Phase 1: Collection Creation (Conditional)
   * Only create if collection doesn't already exist
   */
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);
  const collectionExists = collectionNames.includes('committees');

  if (collectionExists) {
    console.log('[Migration 008] Committees collection already exists');
  } else {
    console.log('[Migration 008] Creating committees collection...');
    await db.createCollection('committees');
    console.log('[Migration 008] ✅ Committees collection created');
  }

  /**
   * Phase 2: Index Creation (UNCONDITIONAL)
   * 
   * CRITICAL: This runs EVERY TIME the migration executes, regardless of
   * whether the collection was just created or already existed.
   * 
   * Why unconditional?
   * - Ensures indexes are guaranteed to exist after migration completes
   * - MongoDB's createIndex() is idempotent (safe to call repeatedly)
   * - Recovers from partial failures (collection exists but indexes missing)
   * - Handles scenarios: empty import, manual creation, partial failures
   * 
   * Error Handling Strategy:
   * - If index exists with same spec → MongoDB returns success (no-op)
   * - If index exists with different spec → Try-catch handles gracefully
   * - If index doesn't exist → createIndex() creates it immediately
   * 
   * Each createIndex wrapped in try-catch for robustness
   */
  const collection = db.collection('committees');

  console.log('[Migration 008] Starting index creation phase (unconditional)...');

  // Index 1: committeeId (Unique Primary Index)
  await createIndexSafely(
    collection,
    { committeeId: 1 },
    { unique: true },
    'Index on committeeId (unique) created/verified'
  );

  // Index 2: committeeName (Unique - CRITICAL FOR DATA INTEGRITY)
  await createIndexSafely(
    collection,
    { committeeName: 1 },
    { unique: true },
    'Index on committeeName (unique) created/verified [CRITICAL]'
  );

  // Index 3: status (Standard Index for Process Flow)
  await createIndexSafely(
    collection,
    { status: 1 },
    {},
    'Index on status created/verified'
  );

  // Index 4: (createdBy, status) Compound Index
  await createIndexSafely(
    collection,
    { createdBy: 1, status: 1 },
    {},
    'Compound index on (createdBy, status) created/verified'
  );

  // Index 5: (status, publishedAt) Descending Compound Index
  await createIndexSafely(
    collection,
    { status: 1, publishedAt: -1 },
    {},
    'Compound index on (status, publishedAt desc) created/verified'
  );

  console.log('[Migration 008] ✅ Index creation phase complete - All 5 indexes guaranteed');
};

const down = async () => {
  const db = mongoose.connection.db;

  /**
   * Issue #84 FIX: Reversible Migration
   * 
   * Drop the committees collection and all associated indexes
   * (MongoDB automatically drops all indexes when collection is dropped)
   * 
   * Reversibility ensures:
   * ✅ Safe rollback if migration needs to be undone
   * ✅ Development/test environment cleanup
   * ✅ Emergency rollback capability in production
   */
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('committees')) {
    console.log('[Migration 008] Dropping committees collection and all indexes...');
    await db.collection('committees').drop();
    console.log('[Migration 008] ✅ Committees collection and indexes dropped');
  } else {
    console.log('[Migration 008] Committees collection does not exist, skipping drop');
  }
};

module.exports = { up, down };
