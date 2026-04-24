/**
 * Migration Index - Loads and exports all available migrations
 * Migrations are applied in the order defined here
 */

const migration001 = require('./001_create_user_schema');
const migration002 = require('./002_add_githubUsername_unique_constraint');
const migration003 = require('./003_create_group_schema');
const migration004 = require('./004_add_operation_type_to_schedule_windows');
const migration005 = require('./005_add_github_fields_to_groups');
const migration006 = require('./006_create_deliverable_schema');
const migration007 = require('./007_create_sprint_record_schema');
const migration008 = require('./008_create_committee_schema'); // D3 Committee Schema eklendi
const migration011 = require('./011_reconcile_process7_canonical_collections');

// Migrations are applied in order
const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008, // Sıralama korunarak listeye dahil edildi
  migration011,
];

module.exports = migrations;  