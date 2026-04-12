/**
 * Migration Index - Loads and exports all available migrations
 * Migrations are applied in the order defined here
 */

const migration001 = require('./001_create_user_schema');
const migration002 = require('./002_add_githubUsername_unique_constraint');
const migration003 = require('./003_create_group_schema');
const migration004 = require('./004_add_operation_type_to_schedule_windows');
const migration005 = require('./005_add_github_fields_to_groups');
const migration006Advisor = require('./006_add_advisor_assignment_fields_to_groups');
const migration007Committee = require('./007_create_committee_schema');
const migration006Deliverable = require('./006_create_deliverable_schema');
const migration008D6 = require('./008_create_d6_sprint_and_contribution_schema');

const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006Advisor,
  migration007Committee,
  migration006Deliverable,
  migration008D6,
];

module.exports = migrations;
