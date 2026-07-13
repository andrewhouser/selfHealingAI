#!/usr/bin/env node
'use strict';

/**
 * remove-field.js — Helper script to remove a field from the database schema
 *
 * Removes a field from database-project/schema.json AND strips that field
 * from existing records by directly modifying the .db file.
 *
 * Usage:
 *   node scripts/remove-field.js <fieldName>
 *
 * Examples:
 *   node scripts/remove-field.js date_of_birth
 *   node scripts/remove-field.js age
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.resolve(__dirname, '..', 'database-project', 'schema.json');
const DB_PATH = path.resolve(__dirname, '..', 'database-project', 'data', 'persons.db');

// Core fields that cannot be removed
const PROTECTED_FIELDS = ['name', 'email', 'address', 'phone_number'];

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/remove-field.js <fieldName>');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/remove-field.js date_of_birth');
    console.log('  node scripts/remove-field.js age');
    console.log('');
    console.log(`Protected fields (cannot be removed): ${PROTECTED_FIELDS.join(', ')}`);
    process.exit(1);
  }

  const fieldName = args[0];

  // Check if it's a protected field
  if (PROTECTED_FIELDS.includes(fieldName)) {
    console.error(`Error: "${fieldName}" is a core field and cannot be removed.`);
    console.error(`Protected fields: ${PROTECTED_FIELDS.join(', ')}`);
    process.exit(1);
  }

  // Read current schema
  let schema;
  try {
    const content = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    schema = JSON.parse(content);
  } catch (err) {
    console.error(`Error reading schema file: ${err.message}`);
    process.exit(1);
  }

  // Check if field exists
  if (!schema.fields || !schema.fields[fieldName]) {
    console.error(`Error: Field "${fieldName}" does not exist in the schema.`);
    console.error(`Current fields: ${Object.keys(schema.fields || {}).join(', ')}`);
    process.exit(1);
  }

  // Remove the field from schema
  delete schema.fields[fieldName];

  // Read, strip field from records, and rewrite the db file
  try {
    const dbContent = fs.readFileSync(DB_PATH, 'utf-8');
    const records = dbContent.trim().split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line));

    for (const record of records) {
      delete record[fieldName];
    }

    const newDbContent = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(DB_PATH, newDbContent, 'utf-8');

    console.log(`✓ Removed "${fieldName}" from ${records.length} records in persons.db`);
  } catch (err) {
    console.error(`Warning: Could not update database file: ${err.message}`);
  }

  // Write updated schema to disk
  fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n', 'utf-8');

  console.log(`✓ Removed field "${fieldName}" from schema.json`);
  console.log('');
  console.log('The cascade should now begin:');
  console.log('  1. API agentic loop detects schema change (field removed)');
  console.log('  2. Developer approves → API regenerates swagger.json');
  console.log('  3. UI agentic loop detects swagger change');
  console.log('  4. Developer approves → UI removes column from table');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
