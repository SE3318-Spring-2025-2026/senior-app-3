/**
 * ================================================================================
 * ISSUE #253: Database Migration - Create Final Grades Collection
 * ================================================================================
 *
 * Migration #014: Create final_grades collection with schema validation
 *
 * Purpose:
 * Create MongoDB collection to persist coordinator approval decisions (Issue #253).
 * Includes:
 * - JSON Schema validation for data integrity
 * - 4 performance indexes for common query patterns
 * - Support for document-level transactions
 * - Safe rollback procedure
 *
 * Process Context:
 * - D7 equivalent: final_grades collection stores approved/published grades
 * - Input: Computed grades from Process 8.3 (SprintContributionRecord)
 * - Process 8.4 (Issue #253): Coordinator approves and optionally overrides
 * - Output: Grades ready for Process 8.5 (Issue #255) publication
 *
 * Data Model:
 * - groupId + studentId (unique constraint)
 * - Status lifecycle: pending → approved → published (or rejected)
 * - Approval metadata: approvedBy, approvedAt, approvalComment
 * - Override tracking: overriddenFinalGrade, overriddenBy, overrideComment
 *
 * ================================================================================
 */

/**
 * ISSUE #253: Migration UP - Create final_grades collection
 *
 * Steps:
 * 1. Create collection with JSON Schema validation
 * 2. Add 4 indexes:
 *    - Unique (groupId, studentId): Ensures one grade per student per group
 *    - (status, approvedAt): Query approved grades in order
 *    - (groupId, status): Query all grades by group status
 *    - (studentId, createdAt): Student view of all their grades
 *
 * @param {Object} db - MongoDB database connection
 */
exports.up = async (db) => {
  try {
    console.log('[Issue #253] Creating final_grades collection...');

    // ISSUE #253: Define JSON Schema for collection validation
    // Ensures data integrity at the database layer
    const schema = {
      $jsonSchema: {
        bsonType: 'object',
        required: [
          'finalGradeId',
          'groupId',
          'publishCycle',
          'studentId',
          'baseGroupScore',
          'individualRatio',
          'computedFinalGrade',
          'status',
          'createdAt'
        ],
        properties: {
          // ===================================================================
          // ISSUE #253: Identity & Context Fields
          // ===================================================================

          _id: { bsonType: 'objectId' },

          finalGradeId: {
            bsonType: 'string',
            description: 'Unique identifier for this final grade record'
          },

          groupId: {
            bsonType: 'string',
            description: 'Group context (D2 reference)'
          },

          publishCycle: {
            bsonType: 'string',
            description: 'Publish cycle identifier for this approval attempt'
          },

          studentId: {
            bsonType: 'string',
            description: 'Student receiving this grade (D1 reference)'
          },

          // ===================================================================
          // ISSUE #253: Computed Grade Fields (Read-only Input)
          // ===================================================================

          baseGroupScore: {
            bsonType: 'number',
            description: 'Base group score before individual ratio adjustment',
            minimum: 0,
            maximum: 100
          },

          individualRatio: {
            bsonType: 'number',
            description: 'Individual contribution ratio (0-1)',
            minimum: 0,
            maximum: 1
          },

          computedFinalGrade: {
            bsonType: 'number',
            description: 'Computed final grade (base * ratio)',
            minimum: 0,
            maximum: 100
          },

          // ===================================================================
          // ISSUE #253: Approval State Fields
          // ===================================================================

          status: {
            bsonType: 'string',
            description: 'Status: pending, approved, rejected, published',
            enum: ['pending', 'approved', 'rejected', 'published']
          },

          approvedBy: {
            bsonType: ['string', 'null'],
            description: 'Coordinator ID who approved'
          },

          approvedAt: {
            bsonType: ['date', 'null'],
            description: 'When was grade approved?'
          },

          approvalComment: {
            bsonType: ['string', 'null'],
            description: 'Approval decision reason/comment'
          },

          // ===================================================================
          // ISSUE #253: Override Fields
          // ===================================================================

          overrideApplied: {
            bsonType: 'bool',
            description: 'Was grade manually overridden?'
          },

          overriddenFinalGrade: {
            bsonType: ['number', 'null'],
            description: 'Override grade if applied',
            minimum: 0,
            maximum: 100
          },

          originalFinalGrade: {
            bsonType: ['number', 'null'],
            description: 'Original computed grade before override'
          },

          overriddenBy: {
            bsonType: ['string', 'null'],
            description: 'Coordinator who applied override'
          },

          overrideComment: {
            bsonType: ['string', 'null'],
            description: 'Justification for override'
          },

          overrideEntries: {
            bsonType: 'array',
            description: 'List of per-student overrides',
            items: {
              bsonType: 'object',
              properties: {
                studentId: { bsonType: 'string' },
                originalFinalGrade: { bsonType: 'number' },
                overriddenFinalGrade: { bsonType: 'number' },
                comment: { bsonType: ['string', 'null'] },
                overriddenAt: { bsonType: 'date' }
              }
            }
          },

          // ===================================================================
          // ISSUE #253: Publication Fields
          // ===================================================================

          publishedAt: {
            bsonType: ['date', 'null'],
            description: 'When was grade published (Issue #255)?'
          },

          publishedBy: {
            bsonType: ['string', 'null'],
            description: 'Coordinator who published grades'
          },

          // ===================================================================
          // ISSUE #253: Audit & Metadata
          // ===================================================================

          createdAt: {
            bsonType: 'date',
            description: 'When was record created?'
          },

          updatedAt: {
            bsonType: 'date',
            description: 'When was record last modified?'
          }
        }
      }
    };

    // ISSUE #253: Create collection with schema validation
    await db.createCollection('final_grades', {
      validator: schema
    });

    console.log('[Issue #253] ✓ Collection created');

    // =========================================================================
    // ISSUE #253: CREATE INDEXES
    // =========================================================================

    // ISSUE #253: INDEX 1 - Unique (groupId, publishCycle, studentId)
    // Ensures one final grade per student per group per cycle
    // Used for: Upsert operations, duplicate prevention
    console.log('[Issue #253] Creating unique index on (groupId, publishCycle, studentId)...');
    await db.collection('final_grades').createIndex(
      { groupId: 1, publishCycle: 1, studentId: 1 },
      {
        unique: true,
        name: 'idx_final_grade_unique_group_cycle_student'
      }
    );
    console.log('[Issue #253] ✓ Unique index created');

    // ISSUE #253: INDEX 2 - (status, approvedAt)
    // Allows efficient query of approved grades sorted by time
    // Query: db.final_grades.find({ status: 'approved', approvedAt: { $lt: now } })
    // Used for: Issue #255 publish process, coordinator dashboard
    console.log('[Issue #253] Creating index on (status, approvedAt)...');
    await db.collection('final_grades').createIndex(
      { status: 1, approvedAt: -1 },
      {
        name: 'idx_final_grade_status_approved_time'
      }
    );
    console.log('[Issue #253] ✓ Status-time index created');

    // ISSUE #253: INDEX 3 - (groupId, status)
    // Allows efficient query of all grades for a group by status
    // Query: db.final_grades.find({ groupId: 'g123', status: 'approved' })
    // Used for: Batch operations, summary queries, Issue #255
    console.log('[Issue #253] Creating index on (groupId, status)...');
    await db.collection('final_grades').createIndex(
      { groupId: 1, status: 1 },
      {
        name: 'idx_final_grade_group_status'
      }
    );
    console.log('[Issue #253] ✓ Group-status index created');

    // ISSUE #253: INDEX 4 - (studentId, createdAt)
    // Allows efficient query of student's grades across all groups
    // Query: db.final_grades.find({ studentId: 's456' }).sort({ createdAt: -1 })
    // Used for: Student dashboard, historical view
    console.log('[Issue #253] Creating index on (studentId, createdAt)...');
    await db.collection('final_grades').createIndex(
      { studentId: 1, createdAt: -1 },
      {
        name: 'idx_final_grade_student_created'
      }
    );
    console.log('[Issue #253] ✓ Student-created index created');

    console.log('[Issue #253] ✓✓✓ Migration UP completed successfully');
  } catch (error) {
    console.error('[Issue #253] Migration UP failed:', error);
    throw error;
  }
};

/**
 * ISSUE #253: Migration DOWN - Drop final_grades collection
 *
 * Rollback procedure:
 * Safely removes final_grades collection and all indexes
 * Used only if migration needs to be reverted
 *
 * @param {Object} db - MongoDB database connection
 */
exports.down = async (db) => {
  try {
    console.log('[Issue #253] Dropping final_grades collection...');

    // ISSUE #253: Check if collection exists before dropping
    const collections = await db.listCollections().toArray();
    const exists = collections.some((c) => c.name === 'final_grades');

    if (exists) {
      // ISSUE #253: Drop collection (this also removes all indexes)
      await db.collection('final_grades').drop();
      console.log('[Issue #253] ✓ Collection dropped');
    } else {
      console.log('[Issue #253] Collection does not exist, skipping');
    }

    console.log('[Issue #253] ✓✓✓ Migration DOWN completed successfully');
  } catch (error) {
    console.error('[Issue #253] Migration DOWN failed:', error);
    throw error;
  }
};
