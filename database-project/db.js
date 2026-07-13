const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'persons.db');

/**
 * Reads persons directly from the .db file (newline-delimited JSON).
 * This ensures external file changes are always picked up without restart.
 * @returns {Array} All person records
 */
function readDbFile() {
  const content = fs.readFileSync(DB_PATH, 'utf-8');
  return content.trim().split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

/**
 * Returns all Person_Record documents.
 * @returns {Promise<Array>}
 */
async function findAll() {
  return readDbFile();
}

/**
 * Returns a single document by _id.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findById(id) {
  const records = readDbFile();
  return records.find(r => r._id === id) || null;
}

/**
 * Inserts a new person record.
 * @param {Object} record
 * @returns {Promise<Object>} The inserted document (with _id)
 */
async function insert(record) {
  const records = readDbFile();
  if (!record._id) {
    record._id = Math.random().toString(36).substring(2, 18);
  }
  records.push(record);
  const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(DB_PATH, content, 'utf-8');
  return record;
}

/**
 * Updates a record by _id with the given fields.
 * @param {string} id
 * @param {Object} fields - Fields to update
 * @returns {Promise<number>} Number of documents updated
 */
async function update(id, fields) {
  const records = readDbFile();
  let updated = 0;
  for (const record of records) {
    if (record._id === id) {
      Object.assign(record, fields);
      updated++;
    }
  }
  if (updated > 0) {
    const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(DB_PATH, content, 'utf-8');
  }
  return updated;
}

/**
 * Removes a record by _id.
 * @param {string} id
 * @returns {Promise<number>} Number of documents removed
 */
async function remove(id) {
  const records = readDbFile();
  const filtered = records.filter(r => r._id !== id);
  const removed = records.length - filtered.length;
  if (removed > 0) {
    const content = filtered.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(DB_PATH, content, 'utf-8');
  }
  return removed;
}

module.exports = {
  findAll,
  findById,
  insert,
  update,
  remove,
  DB_PATH,
};
