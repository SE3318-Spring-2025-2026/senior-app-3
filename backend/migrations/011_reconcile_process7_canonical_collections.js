'use strict';

const ensureCollection = async (db, name) => {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name);
    console.log(`[Migration 011] Created collection: ${name}`);
  }
};

const ensureIndex = async (collection, keys, options = {}) => {
  try {
    await collection.createIndex(keys, options);
  } catch (error) {
    const code = Number(error?.code);
    const message = String(error?.message || '');
    if (
      code === 11000 ||
      code === 85 ||
      code === 86 ||
      message.includes('already exists') ||
      message.includes('IndexOptionsConflict') ||
      message.includes('IndexKeySpecsConflict')
    ) {
      return;
    }
    throw error;
  }
};

const bulkBackfill = async (targetCollection, rows, uniqueKeyBuilder, mapRow) => {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const seen = new Set();
  const operations = [];

  for (const row of rows) {
    const mapped = mapRow(row);
    if (!mapped) continue;

    const dedupeKey = uniqueKeyBuilder(row);
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    operations.push({
      updateOne: {
        filter: mapped.filter,
        update: mapped.update,
        upsert: true,
      },
    });
  }

  if (operations.length === 0) return 0;

  const result = await targetCollection.bulkWrite(operations, { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0);
};

module.exports = {
  name: '011_reconcile_process7_canonical_collections',

  up: async (db) => {
    const mongoDb = db.connection.db;

    await ensureCollection(mongoDb, 'sprint_issues');
    await ensureCollection(mongoDb, 'pr_validations');
    await ensureCollection(mongoDb, 'sprint_contributions');
    await ensureCollection(mongoDb, 'sprint_reports');

    const sprintIssues = mongoDb.collection('sprint_issues');
    const prValidations = mongoDb.collection('pr_validations');
    const sprintContributions = mongoDb.collection('sprint_contributions');
    const sprintReports = mongoDb.collection('sprint_reports');

    await ensureIndex(
      sprintIssues,
      { sprintIssueId: 1 },
      { unique: true, sparse: true, name: 'sprintIssueId_1' }
    );
    await ensureIndex(
      sprintIssues,
      { groupId: 1, sprintId: 1, issueKey: 1 },
      { unique: true, name: 'groupId_1_sprintId_1_issueKey_1' }
    );
    await ensureIndex(sprintIssues, { groupId: 1, sprintId: 1 }, { name: 'groupId_1_sprintId_1' });
    await ensureIndex(
      sprintIssues,
      { groupId: 1, sprintId: 1, syncedAt: -1 },
      { name: 'groupId_1_sprintId_1_syncedAt_-1' }
    );

    await ensureIndex(
      prValidations,
      { prValidationId: 1 },
      { unique: true, sparse: true, name: 'prValidationId_1' }
    );
    await ensureIndex(
      prValidations,
      { groupId: 1, sprintId: 1, issueKey: 1, prId: 1 },
      { unique: true, name: 'groupId_1_sprintId_1_issueKey_1_prId_1' }
    );
    await ensureIndex(prValidations, { groupId: 1, sprintId: 1 }, { name: 'groupId_1_sprintId_1' });
    await ensureIndex(prValidations, { issueKey: 1, mergeStatus: 1 }, { name: 'issueKey_1_mergeStatus_1' });
    await ensureIndex(
      prValidations,
      { groupId: 1, sprintId: 1, validatedAt: -1 },
      { name: 'groupId_1_sprintId_1_validatedAt_-1' }
    );

    await ensureIndex(
      sprintContributions,
      { contributionRecordId: 1 },
      { unique: true, sparse: true, name: 'contributionRecordId_1' }
    );
    // Canonical uniqueness: one contribution row per (group, sprint, student)
    await ensureIndex(
      sprintContributions,
      { groupId: 1, sprintId: 1, studentId: 1 },
      { unique: true, name: 'groupId_1_sprintId_1_studentId_1' }
    );
    // Pair indexes retained for reporting reads (non-unique by design).
    await ensureIndex(sprintContributions, { groupId: 1, sprintId: 1 }, { name: 'groupId_1_sprintId_1' });
    await ensureIndex(sprintContributions, { studentId: 1, sprintId: 1 }, { name: 'studentId_1_sprintId_1' });
    await ensureIndex(
      sprintContributions,
      { groupId: 1, sprintId: 1, updatedAt: -1 },
      { name: 'groupId_1_sprintId_1_updatedAt_-1' }
    );

    await ensureIndex(
      sprintReports,
      { sprintReportId: 1 },
      { unique: true, sparse: true, name: 'sprintReportId_1' }
    );
    await ensureIndex(
      sprintReports,
      { groupId: 1, sprintId: 1 },
      { unique: true, name: 'groupId_1_sprintId_1' }
    );
    await ensureIndex(
      sprintReports,
      { groupId: 1, sprintId: 1, generatedAt: -1 },
      { name: 'groupId_1_sprintId_1_generatedAt_-1' }
    );

    const contributionLegacyExists = await mongoDb.listCollections({ name: 'contributionrecords' }).toArray();
    if (contributionLegacyExists.length > 0) {
      const legacyRows = await mongoDb.collection('contributionrecords').find({}).toArray();
      await bulkBackfill(
        sprintContributions,
        legacyRows,
        (row) => `${row.groupId}:${row.sprintId}:${row.studentId}`,
        (row) => {
          if (!row?.groupId || !row?.sprintId || !row?.studentId) {
            return null;
          }
          return {
            filter: {
              groupId: row.groupId,
              sprintId: row.sprintId,
              studentId: row.studentId,
            },
            update: {
              $set: {
                storyPointsAssigned: Number(row.storyPointsAssigned || 0),
                storyPointsCompleted: Number(row.storyPointsCompleted || 0),
                pullRequestsMerged: Number(row.pullRequestsMerged || 0),
                issuesResolved: Number(row.issuesResolved || 0),
                commitsCount: Number(row.commitsCount || 0),
                jiraIssueKeys: Array.isArray(row.jiraIssueKeys) ? row.jiraIssueKeys : [],
                jiraIssueKey: row.jiraIssueKey || null,
                contributionRatio: Number(row.contributionRatio || 0),
                gitHubHandle: row.gitHubHandle || row.githubHandle || null,
                lastUpdatedAt: row.lastUpdatedAt || row.updatedAt || row.createdAt || new Date(),
                locked: row.locked === true,
                createdAt: row.createdAt || new Date(),
                updatedAt: row.updatedAt || row.lastUpdatedAt || new Date(),
              },
              $setOnInsert: {
                contributionRecordId: row.contributionRecordId,
              },
            },
          };
        }
      );
      console.log('[Migration 011] Reconciled legacy contributions from contributionrecords');
    }

    const githubJobsExists = await mongoDb.listCollections({ name: 'github_sync_jobs' }).toArray();
    if (githubJobsExists.length > 0) {
      const jobs = await mongoDb
        .collection('github_sync_jobs')
        .find({ validationRecords: { $exists: true, $ne: [] } })
        .toArray();

      const validationRows = [];
      for (const job of jobs) {
        for (const record of job.validationRecords || []) {
          if (!record?.issueKey || !record?.prId) continue;
          if (!job?.groupId || !job?.sprintId) continue;

          validationRows.push({
            groupId: job.groupId,
            sprintId: job.sprintId,
            issueKey: record.issueKey,
            prId: String(record.prId),
            prUrl: record.prUrl || null,
            mergeStatus: record.mergeStatus || 'UNKNOWN',
            rawState: record.rawState || null,
            validatedAt: record.lastValidated || job.completedAt || job.updatedAt || new Date(),
          });
        }
      }

      await bulkBackfill(
        prValidations,
        validationRows,
        (row) => `${row.groupId}:${row.sprintId}:${row.issueKey}:${row.prId}`,
        (row) => ({
          filter: {
            groupId: row.groupId,
            sprintId: row.sprintId,
            issueKey: row.issueKey,
            prId: row.prId,
          },
          update: {
            $set: {
              prUrl: row.prUrl,
              mergeStatus: row.mergeStatus,
              rawState: row.rawState,
              validatedAt: row.validatedAt,
              updatedAt: row.validatedAt,
            },
            $setOnInsert: {
              createdAt: row.validatedAt,
            },
          },
        })
      );
      console.log('[Migration 011] Reconciled PR validations from github_sync_jobs');
    }
  },

  down: async (db) => {
    const mongoDb = db.connection.db;
    const collections = ['sprint_issues', 'pr_validations', 'sprint_contributions', 'sprint_reports'];
    for (const name of collections) {
      const existing = await mongoDb.listCollections({ name }).toArray();
      if (existing.length > 0) {
        await mongoDb.collection(name).drop();
      }
    }
  },
};
