'use strict';

const fs = require('fs');
const path = require('path');
const { createFileWatcher } = require('../shared/file-watcher');
const { sendNotification } = require('../shared/notifier');
const { diffSchema } = require('../shared/diff-schema');
const { askApproval } = require('./approval-prompt');
const { performSelfHealingUpdate } = require('./self-heal');

const SCHEMA_PATH = path.resolve(__dirname, '../database-project/schema.json');
const POLLING_INTERVAL = 1000; // 1 second, well within the 2-second max

/**
 * Reads and parses the schema.json file.
 * @param {string} [filePath] - Path to the schema file (defaults to SCHEMA_PATH)
 * @returns {Object|null} Parsed schema object, or null if unreadable
 */
function readSchema(filePath) {
  const target = filePath || SCHEMA_PATH;
  try {
    const content = fs.readFileSync(target, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

/**
 * Starts the API agentic loop that watches the database schema for changes.
 *
 * Behavior:
 * - Watches ../database-project/schema.json with polling interval ≤ 2 seconds
 * - On file change: reads new schema, diffs against cached version, sends notification for added fields
 * - On error (file unreadable): sends notification indicating inaccessibility, continues watching
 *
 * @param {Object} [deps] - Optional dependency overrides (for testing)
 * @param {function} [deps.createFileWatcher] - File watcher factory
 * @param {function} [deps.sendNotification] - Notification sender
 * @param {function} [deps.diffSchema] - Schema diff utility
 * @param {function} [deps.readSchemaFn] - Schema reader function
 * @param {function} [deps.askApproval] - Approval prompt function
 * @param {function} [deps.performSelfHealingUpdate] - Self-healing update function
 * @param {string} [deps.schemaPath] - Path to watch
 * @returns {{ stop: function(): Promise<void> }} Handle with stop() method to close the watcher
 */
function start(deps = {}) {
  const _createFileWatcher = deps.createFileWatcher || createFileWatcher;
  const _sendNotification = deps.sendNotification || sendNotification;
  const _diffSchema = deps.diffSchema || diffSchema;
  const _readSchema = deps.readSchemaFn || readSchema;
  const _askApproval = deps.askApproval || askApproval;
  const _performSelfHealingUpdate = deps.performSelfHealingUpdate || performSelfHealingUpdate;
  const _schemaPath = deps.schemaPath || SCHEMA_PATH;

  let cachedSchema = _readSchema(_schemaPath);

  const watcher = _createFileWatcher(_schemaPath, {
    interval: POLLING_INTERVAL,

    onChange: async (filePath) => {
      const newSchema = _readSchema(_schemaPath);

      if (!newSchema) {
        // File became unreadable after change event
        _sendNotification({
          title: 'API_Project: Schema Unreadable',
          message: 'The database schema file could not be read after a change was detected',
          project: 'API_Project',
          changeType: 'field_added',
          fieldName: 'schema.json',
        });
        return;
      }

      const diff = _diffSchema(cachedSchema || {}, newSchema);

      // Update cached schema immediately so subsequent changes diff correctly
      cachedSchema = newSchema;

      if (diff.addedFields.length > 0 || diff.removedFields.length > 0) {
        const added = diff.addedFields;
        const removed = diff.removedFields;
        const allChanges = [...added, ...removed];
        const summary = [];
        if (added.length > 0) summary.push(`added: ${added.join(', ')}`);
        if (removed.length > 0) summary.push(`removed: ${removed.join(', ')}`);
        const fieldNames = allChanges.join(', ');
        const changeType = removed.length > 0 && added.length === 0 ? 'field_removed' : 'field_added';

        _sendNotification({
          title: 'API_Project: Change Detected',
          message: `Schema change — ${summary.join('; ')}`,
          project: 'API_Project',
          changeType: changeType,
          fieldName: fieldNames,
        });

        // Prompt developer for approval before proceeding with self-healing
        const approved = await _askApproval(
          `Schema change detected: ${summary.join('; ')}. Apply automatic update to API?`
        );

        if (approved) {
          console.log(`Update approved for field(s): ${fieldNames}. Applying self-healing update...`);
          const success = await _performSelfHealingUpdate(diff.addedFields, diff.removedFields);
          if (success) {
            console.log(`Self-healing update completed successfully for: ${summary.join('; ')}`);
          } else {
            console.log(`Self-healing update failed. Continuing to watch...`);
          }
        } else {
          console.log(`Update rejected for: ${summary.join('; ')}. Continuing to watch...`);
        }
      }
    },

    onError: (error) => {
      _sendNotification({
        title: 'API_Project: Schema Inaccessible',
        message: 'The database schema file is no longer accessible',
        project: 'API_Project',
        changeType: 'field_added',
        fieldName: 'schema.json',
      });
    },
  });

  return {
    /**
     * Stops the file watcher and ends the agentic loop.
     * @returns {Promise<void>}
     */
    stop() {
      return watcher.close();
    },
  };
}

module.exports = { start, readSchema, SCHEMA_PATH, POLLING_INTERVAL };

// If run directly, start the loop
if (require.main === module) {
  const handle = start();
  console.log('API agentic loop is running. Watching for schema changes...');
  console.log(`Watching: ${SCHEMA_PATH}`);

  // Graceful shutdown on SIGINT/SIGTERM
  process.on('SIGINT', async () => {
    console.log('\nStopping API agentic loop...');
    await handle.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await handle.stop();
    process.exit(0);
  });
}
