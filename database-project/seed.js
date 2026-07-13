const fs = require('fs');
const path = require('path');
const { insert, findAll } = require('./db');

const SCHEMA_PATH = path.join(__dirname, 'schema.json');

const sampleRecords = [
  { name: 'Alice Johnson', email: 'alice@example.com', address: '123 Main St', phone_number: '555-0101' },
  { name: 'Bob Smith', email: 'bob@example.com', address: '456 Oak Ave', phone_number: '555-0102' },
  { name: 'Charlie Brown', email: 'charlie@example.com', address: '789 Pine Rd', phone_number: '555-0103' }
];

/**
 * Reads the schema file and returns the list of required field names.
 * @returns {string[]} Array of required field names
 */
function getRequiredFields() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  const fields = schema.fields || {};
  return Object.entries(fields)
    .filter(([, def]) => def.required)
    .map(([name]) => name);
}

/**
 * Validates a record against the schema's required fields.
 * @param {Object} record - The record to validate
 * @param {string[]} requiredFields - List of required field names
 * @returns {{ valid: boolean, missingFields: string[] }}
 */
function validateRecord(record, requiredFields) {
  const missingFields = requiredFields.filter(
    (field) => record[field] === undefined || record[field] === null || record[field] === ''
  );
  return { valid: missingFields.length === 0, missingFields };
}

/**
 * Seeds the database with sample Person_Record entities.
 */
async function seed() {
  const requiredFields = getRequiredFields();
  console.log(`Schema requires fields: ${requiredFields.join(', ')}`);

  // Check if database already has records
  const existing = await findAll();
  if (existing.length > 0) {
    console.log(`Database already contains ${existing.length} record(s). Skipping seed.`);
    return;
  }

  for (const record of sampleRecords) {
    const { valid, missingFields } = validateRecord(record, requiredFields);
    if (!valid) {
      console.error(`Validation failed for record "${record.name}": missing fields [${missingFields.join(', ')}]`);
      process.exit(1);
    }

    const inserted = await insert(record);
    console.log(`Inserted: ${inserted.name} (id: ${inserted._id})`);
  }

  console.log(`Database seeded successfully with ${sampleRecords.length} person records.`);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
