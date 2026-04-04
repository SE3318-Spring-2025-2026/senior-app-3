/**
 * Migration Index - Loads and exports all available migrations
 * Migrations are applied in the order defined here
 */

const migration001 = require('./001_create_user_schema');
const migration002 = require('./002_add_githubUsername_unique_constraint');

// Migrations are applied in order
const migrations = [
  migration001,
  migration002,
];

module.exports = migrations;
