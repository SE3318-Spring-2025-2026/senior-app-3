/**
 * Migration Index - Loads and exports all available migrations
 * Migrations are applied in the order defined here
 */

const migration001 = require('./001_create_user_schema');
const migration002 = require('./002_add_githubUsername_unique_constraint');
const migration003 = require('./003_create_group_schema');
const migration004 = require('./004_add_operation_type_to_schedule_windows');
const migration005 = require('./005_add_github_fields_to_groups');
const migration006a = require('./006_add_advisor_assignment_fields_to_groups');
const migration006 = require('./006_create_deliverable_schema');
const migration007 = require('./007_create_sprint_record_schema');
const migration008 = require('./008_create_committee_schema');
const migration009a = require('./009_d4_deliverables_storage_schema');
const migration009b = require('./009_d6_schema_enhancement');
const migration010 = require('./010_create_review_schema');
const migration011 = require('./011_reconcile_process7_canonical_collections');

// Migrations are applied in order
const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006a,
  migration006,
  migration007,
  migration008,
  migration009a,
  migration009b,
  migration010,
  migration011,
];

module.exports = migrations;  
