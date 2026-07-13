#!/usr/bin/env node
'use strict';

/**
 * add-field.js — Helper script to add a field to the database schema
 *
 * Adds a new field to database-project/schema.json AND uses the LLM to generate
 * contextually appropriate sample data for existing records.
 *
 * Directly modifies the .db file (newline-delimited JSON) to avoid
 * multi-process conflicts with the running API server's NeDB instance.
 *
 * Usage:
 *   node scripts/add-field.js <fieldName> [fieldType]
 *
 * Examples:
 *   node scripts/add-field.js date_of_birth string
 *   node scripts/add-field.js age number
 *   node scripts/add-field.js nickname
 */

const fs = require('fs');
const path = require('path');
const { callLLM, extractCode } = require('../shared/llm-client');

const SCHEMA_PATH = path.resolve(__dirname, '..', 'database-project', 'schema.json');
const DB_PATH = path.resolve(__dirname, '..', 'database-project', 'data', 'persons.db');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/add-field.js <fieldName> [fieldType]');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/add-field.js date_of_birth string');
    console.log('  node scripts/add-field.js age number');
    console.log('  node scripts/add-field.js nickname');
    process.exit(1);
  }

  const fieldName = args[0];
  const fieldType = args[1] || 'string';

  // Validate field name
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
    console.error(`Error: "${fieldName}" is not a valid field name.`);
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

  // Check if field already exists
  if (schema.fields && schema.fields[fieldName]) {
    console.error(`Error: Field "${fieldName}" already exists in the schema.`);
    process.exit(1);
  }

  // Add the new field to schema
  if (!schema.fields) {
    schema.fields = {};
  }
  schema.fields[fieldName] = { type: fieldType, required: false };

  // Read and parse the db file directly (each line is a JSON document)
  let records;
  try {
    const dbContent = fs.readFileSync(DB_PATH, 'utf-8');
    records = dbContent.trim().split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line));
  } catch (err) {
    console.error(`Error reading database file: ${err.message}`);
    process.exit(1);
  }

  // Use LLM to generate contextually appropriate sample data
  try {
    console.log(`Generating sample "${fieldName}" data for ${records.length} records using LLM...`);

    const recordSummary = records.map(r => `- ${r.name} (${r.email})`).join('\n');

    const systemPrompt = `You generate realistic sample data for database records. Output ONLY valid JSON — no explanations, no markdown.`;

    const userPrompt = `I have these person records:
${recordSummary}

I'm adding a new field "${fieldName}" (type: ${fieldType}) to each record.

Generate an appropriate "${fieldName}" value for each person. The values should be realistic and contextually relevant to each person's name.

Respond with ONLY a JSON array of values in the same order as the persons listed above. Example format:
["value1", "value2", "value3"]${fieldType === 'number' ? '\n\nSince the type is number, use numeric values like: [34, 29, 41]' : ''}`;

    const response = await callLLM(systemPrompt, userPrompt, { maxTokens: 256 });
    const cleaned = extractCode(response, 'json');

    let values;
    try {
      values = JSON.parse(cleaned);
    } catch (parseErr) {
      const arrayMatch = response.match(/\[[\s\S]*?\]/);
      if (arrayMatch) {
        values = JSON.parse(arrayMatch[0]);
      } else {
        throw new Error(`Could not parse LLM response as JSON: ${cleaned.slice(0, 100)}`);
      }
    }

    // Add the new field to each record
    for (let i = 0; i < records.length; i++) {
      const value = values[i] !== undefined ? values[i] : `${fieldName}_${i + 1}`;
      records[i][fieldName] = value;
      console.log(`  ${records[i].name} → ${fieldName}: ${value}`);
    }
  } catch (err) {
    console.error(`Warning: LLM data generation failed: ${err.message}`);
    console.error('  Using generic sample data instead...');

    for (let i = 0; i < records.length; i++) {
      records[i][fieldName] = `${fieldName}_${i + 1}`;
    }
  }

  // Write updated records back to db file
  const newDbContent = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(DB_PATH, newDbContent, 'utf-8');
  console.log(`✓ Updated ${records.length} records in persons.db`);

  // Write updated schema to disk (AFTER populating data so cascade triggers with data in place)
  fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
  console.log(`✓ Added field "${fieldName}" (type: ${fieldType}) to schema.json`);
  console.log('');
  console.log('The cascade should now begin:');
  console.log('  1. API agentic loop detects schema change');
  console.log('  2. Developer approves → API regenerates swagger.json');
  console.log('  3. UI agentic loop detects swagger change');
  console.log('  4. Developer approves → UI updates table component');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
