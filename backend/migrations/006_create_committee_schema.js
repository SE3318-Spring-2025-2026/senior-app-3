/**
 * Issue #87: Migration 006 - Create D3 Committees Collection
 * 
 * Purpose:
 * Create MongoDB collection for Committee records (D3 data store).
 * Required for Processes 4.0-4.5 and Issue #87 notification integration.
 * 
 * Collection: committees
 * Primary Key: committeeId (unique)
 * 
 * Indexes Strategy (5 total):
 * 
 * 1. {committeeId: 1} UNIQUE
 *    - Purpose: Enforce uniqueness, primary key lookup
 *    - Query: Committee.findOne({committeeId})
 *    - Used in: All processes (4.1-4.5)
 * 
 * 2. {committeeName: 1} UNIQUE
 *    - Purpose: Enforce unique committee names, duplicate check
 *    - Query: Committee.findOne({committeeName})
 *    - Used in: Process 4.1 (prevent duplicate committee names)
 * 
 * 3. {status: 1}
 *    - Purpose: Query by status
 *    - Query: Committee.find({status: 'validated'})
 *    - Used in: Process 4.4, 4.5 (find committees ready to publish)
 * 
 * 4. {createdBy: 1, status: 1}
 *    - Purpose: Compound index for coordinator's committees
 *    - Query: Committee.find({createdBy: coordinatorId, status: 'draft'})
 *    - Used in: Process 4.2-4.5 (coordinator workflow)
 * 
 * 5. {status: 1, publishedAt: -1}
 *    - Purpose: Published committees sorted by publish time (descending)
 *    - Query: Committee.find({status: 'published'}).sort({publishedAt: -1})
 *    - Used in: Issue #87 (notification audit trail, recent publications)
 * 
 * Idempotency:
 * - up(): Creates collection only if it doesn't exist
 * - down(): Safely drops collection with error suppression
 * - Safe for multiple runs without side effects
 * 
 * Rollback:
 * - Migration framework calls down() to rollback
 * - This drops entire collection and indexes
 * - Only safe for dev/test environments
 */
module.exports = {
  up: async (db) => {
    // D3: Create committees collection with indexes
    const committeeCollection = db.collection('committees');

    /**
     * Index 1: Primary key - committeeId (unique)
     * Fast lookup by ID, prevents duplicate IDs
     */
    await committeeCollection.createIndex({ committeeId: 1 }, { unique: true });

    /**
     * Index 2: Unique committee names
     * Prevents two committees with same name
     * Used in Process 4.1 duplicate check
     */
    await committeeCollection.createIndex({ committeeName: 1 }, { unique: true });

    /**
     * Index 3: Status lookup
     * Query committees by status (draft/validated/published)
     * Used in Process 4.4-4.5 validation and publish workflows
     */
    await committeeCollection.createIndex({ status: 1 });

    /**
     * Index 4: Coordinator + Status compound
     * Efficient for finding coordinator's committees in specific status
     * Used in Process 4.2-4.5 committee management
     */
    await committeeCollection.createIndex({ createdBy: 1, status: 1 });

    /**
     * Index 5: Status + PublishedAt (descending)
     * Find published committees sorted by publish time
     * Used in Issue #87 for notification audit and recent publications
     * Descending order ensures newest publications first
     */
    await committeeCollection.createIndex({ status: 1, publishedAt: -1 });

    console.log('[Migration 006] D3 committees collection created with indexes');
  },

  down: async (db) => {
    // Drop collection
    await db.collection('committees').drop().catch(() => {});
    console.log('[Migration 006] D3 committees collection dropped');
  },
};
