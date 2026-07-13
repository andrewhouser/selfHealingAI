'use strict';

const fs = require('fs');
const path = require('path');
const { addFieldToEndpoint, removeFieldFromEndpoint } = require('./code-updater');
const { generateSwagger } = require('./swagger-generator');
const { sendNotification } = require('../shared/notifier');

const ROUTES_PATH = path.resolve(__dirname, 'routes/persons.js');

/**
 * Performs the self-healing update for the API project:
 * 1. Reads the current routes/persons.js
 * 2. Applies addFieldToEndpoint for each added field
 * 3. Writes updated code back to routes/persons.js
 * 4. Regenerates swagger.json
 * 5. Sends success notification
 *
 * On failure, reverts routes/persons.js to its original content and sends failure notification.
 *
 * @param {string[]} addedFields - Array of field names to add
 * @param {string[]} [removedFields] - Array of field names that were removed
 * @param {Object} [deps] - Optional dependency overrides (for testing)
 * @param {function} [deps.readFile] - Custom file reader
 * @param {function} [deps.writeFile] - Custom file writer
 * @param {function} [deps.addFieldToEndpoint] - Custom code updater
 * @param {function} [deps.generateSwagger] - Custom swagger generator
 * @param {function} [deps.sendNotification] - Custom notification sender
 * @param {string} [deps.routesPath] - Custom path to routes/persons.js
 * @returns {Promise<boolean>} true if update succeeded, false if it failed and was reverted
 */
async function performSelfHealingUpdate(addedFields, removedFields, deps = {}) {
  // Support old call signature: performSelfHealingUpdate(addedFields, deps)
  if (removedFields && !Array.isArray(removedFields)) {
    deps = removedFields;
    removedFields = [];
  }
  if (!removedFields) removedFields = [];
  const _readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf-8'));
  const _writeFile = deps.writeFile || ((p, content) => fs.writeFileSync(p, content, 'utf-8'));
  const _addFieldToEndpoint = deps.addFieldToEndpoint || addFieldToEndpoint;
  const _removeFieldFromEndpoint = deps.removeFieldFromEndpoint || removeFieldFromEndpoint;
  const _generateSwagger = deps.generateSwagger || generateSwagger;
  const _sendNotification = deps.sendNotification || sendNotification;
  const _routesPath = deps.routesPath || ROUTES_PATH;

  // Step 1: Read original code (backup for revert)
  let originalCode;
  try {
    originalCode = _readFile(_routesPath);
  } catch (err) {
    // Cannot read routes file — send failure notification
    await _sendNotification({
      title: 'API_Project: Update Failed',
      message: `Failed to read routes/persons.js: ${err.message}`,
      project: 'API_Project',
      changeType: 'endpoint_updated',
      fieldName: addedFields.join(', '),
    });
    return false;
  }

  // Step 2: Apply code updates for each added/removed field (LLM-powered)
  let updatedCode = originalCode;
  try {
    for (const fieldName of addedFields) {
      updatedCode = await _addFieldToEndpoint(updatedCode, fieldName);
    }
    for (const fieldName of removedFields) {
      updatedCode = await _removeFieldFromEndpoint(updatedCode, fieldName);
    }
  } catch (err) {
    const allFields = [...addedFields, ...removedFields];
    // Code generation failed — send failure notification (no file changes to revert)
    await _sendNotification({
      title: 'API_Project: Update Failed',
      message: `Code generation failed for field(s) [${allFields.join(', ')}]: ${err.message}`,
      project: 'API_Project',
      changeType: 'endpoint_updated',
      fieldName: allFields.join(', '),
    });
    return false;
  }

  // Step 3: Write updated code to routes/persons.js
  try {
    _writeFile(_routesPath, updatedCode);
  } catch (err) {
    // Write failed — send failure notification (original file may be corrupted, attempt revert)
    try {
      _writeFile(_routesPath, originalCode);
    } catch (revertErr) {
      // Revert also failed — log but continue
      console.error('Failed to revert routes/persons.js:', revertErr.message);
    }
    await _sendNotification({
      title: 'API_Project: Update Failed',
      message: `Failed to write updated routes/persons.js: ${err.message}`,
      project: 'API_Project',
      changeType: 'endpoint_updated',
      fieldName: addedFields.join(', '),
    });
    return false;
  }

  // Step 4: Regenerate swagger.json
  try {
    _generateSwagger();
  } catch (err) {
    // Swagger regeneration failed — revert routes/persons.js
    try {
      _writeFile(_routesPath, originalCode);
    } catch (revertErr) {
      console.error('Failed to revert routes/persons.js:', revertErr.message);
    }
    await _sendNotification({
      title: 'API_Project: Update Failed',
      message: `Swagger regeneration failed for field(s) [${addedFields.join(', ')}]: ${err.message}`,
      project: 'API_Project',
      changeType: 'endpoint_updated',
      fieldName: addedFields.join(', '),
    });
    return false;
  }

  // Step 5: Send success notification
  const allFields = [...addedFields, ...removedFields];
  const summaryParts = [];
  if (addedFields.length > 0) summaryParts.push(`added: ${addedFields.join(', ')}`);
  if (removedFields.length > 0) summaryParts.push(`removed: ${removedFields.join(', ')}`);

  await _sendNotification({
    title: 'API_Project: Update Complete',
    message: `Endpoint updated — ${summaryParts.join('; ')}`,
    project: 'API_Project',
    changeType: 'endpoint_updated',
    fieldName: allFields.join(', '),
  });

  return true;
}

module.exports = { performSelfHealingUpdate, ROUTES_PATH };
