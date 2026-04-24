'use strict';

const ensureCollection = async (db, name) => {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name);
    console.log(`[Migration 011] Created collection: ${name}`);
  } else {
    console.log(`[Migration 011] Collection already exists: ${name}`);
  }
};

const normalizeIndexOptions = (options = {}) => ({
  unique: options.unique === true,
  sparse: options.sparse === true,
  partialFilterExpression: options.partialFilterExpression || null,
});

const indexOptionsMatch = (existing, requested = {}) => {
  const left = normalizeIndexOptions(existing);
  const right = normalizeIndexOptions(requested);
  return JSON.stringify(left) === JSON.stringify(right);
};

const indexKeysMatch = (left = {}, right = {}) => JSON.stringify(left) === JSON.stringify(right);

const ensureIndex = async (collection, keys, options = {}) => {
  const requestedName = options.name;
  const indexes = await collection.indexes();
  const existingByName = requestedName
    ? indexes.find((index) => index.name === requestedName)
    : null;
  const sameKeysDifferentName = indexes.find(
    (index) => index.name !== requestedName && indexKeysMatch(index.key, keys)
  );

  if (existingByName) {
    const sameKeys = indexKeysMatch(existingByName.key, keys);
    const sameOptions = indexOptionsMatch(existingByName, options);

    if (sameKeys && sameOptions) {
      return;
    }

    await collection.dropIndex(existingByName.name);
  }

  if (sameKeysDifferentName) {
    if (indexOptionsMatch(sameKeysDifferentName, options)) {
      console.log(
        `[Migration 011] Index key match found with different name (${sameKeysDifferentName.name}); keeping existing index`
      );
      return;
    }

    console.log(
      `[Migration 011] Index conflict on same keys: dropping ${sameKeysDifferentName.name} to create ${requestedName}`
    );
    await collection.dropIndex(sameKeysDifferentName.name);
  }

  try {
    await collection.createIndex(keys, options);
  } catch (error) {
    if (error?.code === 11000 || error?.code === 85 || error?.code === 86 || error?.code === 68) {
      if (requestedName) {
        try {
          await collection.dropIndex(requestedName);
          await collection.createIndex(keys, options);
          return;
        } catch (retryError) {
          throw retryError;
        }
      }

      console.warn(
        `[Migration 011] Index creation conflict without explicit index name for keys: ${JSON.stringify(keys)}`
      );
    }

    throw error;
  }
};

const hasRequiredFields = (row, requiredFields = []) =>
  requiredFields.every((field) => row?.[field] !== undefined && row?.[field] !== null && row?.[field] !== '');

const bulkBackfill = async (
  targetCollection,
  rows,
  uniqueKeyBuilder,
  mapRow,
  { requiredFields = [], logLabel = 'rows' } = {}
) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const seen = new Set();
  const operations = [];
  let skippedMissingIds = 0;

  for (const row of rows) {
    if (!hasRequiredFields(row, requiredFields)) {
      skippedMissingIds += 1;
      continue;
    }

    const key = uniqueKeyBuilder(row);
    if (seen.has(key)) continue;
    seen.add(key);

    operations.push({
      updateOne: {
        filter: mapRow(row).filter,
        update: mapRow(row).update,
        upsert: true,
      },
    });
  }

  if (operations.length === 0) {
    if (skippedMissingIds > 0) {
      console.log(`[Migration 011] Skipped ${skippedMissingIds} malformed ${logLabel} during backfill`);
    }
    return 0;
  }

  const result = await targetCollection.bulkWrite(operations, { ordered: false });
  if (skippedMissingIds > 0) {
    console.log(`[Migration 011] Skipped ${skippedMissingIds} malformed ${logLabel} during backfill`);
  }
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

    await ensureIndex(sprintIssues, { sprintIssueId: 1 }, { unique: true, sparse: true, name: 'sprintIssueId_1' });
    await ensureIndex(sprintIssues, { groupId: 1, sprintId: 1, issueKey: 1 }, { unique: true, name: 'groupId_1_sprintId_1_issueKey_1' });
    await ensureIndex(sprintIssues, { groupId: 1, sprintId: 1 }, { name: 'groupId_1_sprintId_1' });
    await ensureIndex(sprintIssues, { groupId: 1, sprintId: 1, syncedAt: -1 }, { name: 'groupId_1_sprintId_1_syncedAt_-1' });

    await ensureIndex(prValidations, { prValidationId: 1 }, { unique: true, sparse: true, name: 'prValidationId_1' });
    await ensureIndex(prValidations, { groupId: 1, sprintId: 1, issueKey: 1, prId: 1 }, { unique: true, name: 'groupId_1_sprintId_1_issueKey_1_prId_1' });
    await ensureIndex(prValidations, { groupId: 1, sprintId: 1 }, { name: 'groupId_1_sprintId_1' });
    await ensureIndex(prValidations, { issueKey: 1, mergeStatus: 1 }, { name: 'issueKey_1_mergeStatus_1' });
    await ensureIndex(prValidations, { groupId: 1, sprintId: 1, validatedAt: -1 }, { name: 'groupId_1_sprintId_1_validatedAt_-1' });

    await ensureIndex(sprintContributions, { contributionRecordId: 1 }, { unique: true, sparse: true, name: 'contributionRecordId_1' });
    await ensureIndex(sprintContributions, { groupId: 1, sprintId: 1, studentId: 1 }, { unique: true, name: 'groupId_1_sprintId_1_studentId_1' });
    await ensureIndex(sprintContributions, { groupId: 1, sprintId: 1 }, { name: 'groupId_1_sprintId_1' });
    await ensureIndex(sprintContributions, { studentId: 1, sprintId: 1 }, { name: 'studentId_1_sprintId_1' });
    await ensureIndex(sprintContributions, { groupId: 1, sprintId: 1, updatedAt: -1 }, { name: 'groupId_1_sprintId_1_updatedAt_-1' });

    await ensureIndex(sprintReports, { sprintReportId: 1 }, { unique: true, sparse: true, name: 'sprintReportId_1' });
    await ensureIndex(
      sprintReports,
      { groupId: 1, sprintId: 1, reportType: 1 },
      { unique: true, name: 'groupId_1_sprintId_1_reportType_1' }
    );
    await ensureIndex(sprintReports, { groupId: 1, sprintId: 1, generatedAt: -1 }, { name: 'groupId_1_sprintId_1_generatedAt_-1' });
    await ensureIndex(sprintReports, { deliverableId: 1, sprintId: 1 }, { name: 'deliverableId_1_sprintId_1' });
    await ensureIndex(sprintReports, { deliverableIds: 1 }, { name: 'deliverableIds_1' });
    await ensureIndex(sprintReports, { sourceVersionRef: 1 }, { name: 'sourceVersionRef_1' });

    const legacyContributionCollections = ['contributionrecords'];
    for (const legacyName of legacyContributionCollections) {
      const existing = await mongoDb.listCollections({ name: legacyName }).toArray();
      if (existing.length === 0) continue;

      const legacyRows = await mongoDb.collection(legacyName).find({}).toArray();
      await bulkBackfill(
        sprintContributions,
        legacyRows,
        (row) => JSON.stringify([row.groupId, row.sprintId, row.studentId]),
        (row) => ({
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
              gitHubHandle: row.gitHubHandle || null,
              lastUpdatedAt: row.lastUpdatedAt || row.updatedAt || row.createdAt || new Date(),
              locked: row.locked === true,
              createdAt: row.createdAt || new Date(),
              updatedAt: row.updatedAt || row.lastUpdatedAt || new Date(),
            },
            $setOnInsert: {
              contributionRecordId: row.contributionRecordId,
            },
          },
        }),
        {
          requiredFields: ['groupId', 'sprintId', 'studentId'],
          logLabel: `${legacyName} contribution rows`,
        }
      );
      console.log(`[Migration 011] Reconciled legacy contributions from ${legacyName}`);
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
        (row) => JSON.stringify([row.groupId, row.sprintId, row.issueKey, row.prId]),
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
        }),
        {
          requiredFields: ['groupId', 'sprintId', 'issueKey', 'prId'],
          logLabel: 'github_sync_jobs validation rows',
        }
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
        console.log(`[Migration 011] Dropped collection: ${name}`);
      }
    }
  },
};
