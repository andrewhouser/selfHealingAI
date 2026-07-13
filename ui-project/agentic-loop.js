'use strict';

const fs = require('fs');
const path = require('path');
const { createFileWatcher } = require('../shared/file-watcher');
const { sendNotification } = require('../shared/notifier');
const { diffSwagger } = require('../shared/diff-schema');
const { askApproval: defaultAskApproval } = require('./approval-prompt');
const { performSelfHealingUpdate: defaultPerformSelfHealingUpdate } = require('./self-heal');

const SWAGGER_PATH = path.resolve(__dirname, '../api-project/swagger.json');
const POLLING_INTERVAL = 1000; // 1 second, well within the 2-second max

/**
 * Reads and parses the swagger.json file.
 * @param {string} [filePath] - Path to the swagger file (defaults to SWAGGER_PATH)
 * @returns {{ data: Object|null, parseError: boolean }} Parsed swagger object or null with error flag
 */
function readSwagger(filePath) {
  const target = filePath || SWAGGER_PATH;
  try {
    const content = fs.readFileSync(target, 'utf-8');
    const data = JSON.parse(content);
    return { data, parseError: false };
  } catch (err) {
    // Distinguish between file-not-found and JSON parse errors
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      return { data: null, parseError: false };
    }
    // JSON parse error or other read issue — file exists but content is invalid
    return { data: null, parseError: true };
  }
}

/**
 * Merges a new SchemaDiff into the cumulative diff tracking object.
 * Ensures no duplicate field names across categories.
 *
 * @param {Object} cumulative - Current cumulative changes { addedFields, removedFields, modifiedFields }
 * @param {Object} newDiff - New diff to merge in
 * @returns {Object} Updated cumulative changes
 */
function mergeDiffs(cumulative, newDiff) {
  const addedSet = new Set([...cumulative.addedFields, ...newDiff.addedFields]);
  const removedSet = new Set([...cumulative.removedFields, ...newDiff.removedFields]);
  const modifiedSet = new Set([...cumulative.modifiedFields, ...newDiff.modifiedFields]);

  // If a field was added and then removed, it nets out
  // If a field was removed and then added, it becomes modified
  // Keep it simple for demo: just accumulate unique field names per category
  return {
    addedFields: [...addedSet],
    removedFields: [...removedSet],
    modifiedFields: [...modifiedSet],
  };
}

/**
 * Checks if a cumulative diff has any changes.
 * @param {Object} diff - { addedFields, removedFields, modifiedFields }
 * @returns {boolean}
 */
function hasChanges(diff) {
  return (
    diff.addedFields.length > 0 ||
    diff.removedFields.length > 0 ||
    diff.modifiedFields.length > 0
  );
}

/**
 * Formats a summary message from a cumulative diff.
 * @param {Object} diff - { addedFields, removedFields, modifiedFields }
 * @returns {string}
 */
function formatChangeSummary(diff) {
  const parts = [];
  if (diff.addedFields.length > 0) {
    parts.push(`Added: ${diff.addedFields.join(', ')}`);
  }
  if (diff.removedFields.length > 0) {
    parts.push(`Removed: ${diff.removedFields.join(', ')}`);
  }
  if (diff.modifiedFields.length > 0) {
    parts.push(`Modified: ${diff.modifiedFields.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Returns the primary field name for notification purposes.
 * Uses the first changed field across all categories.
 * @param {Object} diff - { addedFields, removedFields, modifiedFields }
 * @returns {string}
 */
function getPrimaryFieldName(diff) {
  const allFields = [...diff.addedFields, ...diff.removedFields, ...diff.modifiedFields];
  return allFields.join(', ');
}

/**
 * Starts the UI agentic loop that watches the API swagger.json for changes.
 *
 * Behavior:
 * - Watches ../api-project/swagger.json with polling interval ≤ 2 seconds
 * - On file change: reads new swagger, diffs against cached version
 * - If invalid JSON: sends parse-error notification, continues watching
 * - If changes detected: sends notification with project "UI_Project", changeType "endpoint_updated"
 * - Tracks cumulative changes: if new change arrives while prompt is pending, accumulates all changes
 * - On error (file inaccessible): sends notification, continues watching
 *
 * @param {Object} [deps] - Optional dependency overrides (for testing)
 * @param {function} [deps.createFileWatcher] - File watcher factory
 * @param {function} [deps.sendNotification] - Notification sender
 * @param {function} [deps.diffSwagger] - Swagger diff utility
 * @param {function} [deps.readSwaggerFn] - Swagger reader function
 * @param {function} [deps.askApproval] - Terminal approval prompt function
 * @param {function} [deps.performSelfHealingUpdate] - Self-healing update function
 * @param {string} [deps.swaggerPath] - Path to watch
 * @returns {{ stop: function(): Promise<void>, getCumulativeChanges: function(): Object, isPromptPending: function(): boolean, clearPendingPrompt: function(): void, setPendingPrompt: function(boolean): void }} Handle with control methods
 */
function start(deps = {}) {
  const _createFileWatcher = deps.createFileWatcher || createFileWatcher;
  const _sendNotification = deps.sendNotification || sendNotification;
  const _diffSwagger = deps.diffSwagger || diffSwagger;
  const _readSwagger = deps.readSwaggerFn || readSwagger;
  const _askApproval = deps.askApproval || defaultAskApproval;
  const _performSelfHealingUpdate = deps.performSelfHealingUpdate || defaultPerformSelfHealingUpdate;
  const _swaggerPath = deps.swaggerPath || SWAGGER_PATH;

  // Cache the initial swagger state
  const initialRead = _readSwagger(_swaggerPath);
  let cachedSwagger = initialRead.data;

  // Cumulative change tracking for requirement 6.6
  let cumulativeChanges = { addedFields: [], removedFields: [], modifiedFields: [] };
  let promptPending = false;

  /**
   * Clears the pending prompt state and resets cumulative changes.
   * Called after developer approves or rejects.
   */
  function _clearPendingPrompt() {
    promptPending = false;
    cumulativeChanges = { addedFields: [], removedFields: [], modifiedFields: [] };
  }

  const watcher = _createFileWatcher(_swaggerPath, {
    interval: POLLING_INTERVAL,

    onChange: (filePath) => {
      const result = _readSwagger(_swaggerPath);

      if (result.parseError) {
        // Requirement 6.5: invalid JSON — notify parse error, continue watching
        _sendNotification({
          title: 'UI_Project: Swagger Parse Error',
          message: 'The swagger.json file contains invalid JSON and could not be parsed',
          project: 'UI_Project',
          changeType: 'endpoint_updated',
          fieldName: 'swagger.json',
        });
        return;
      }

      if (!result.data) {
        // File unreadable (not a parse error, just inaccessible)
        _sendNotification({
          title: 'UI_Project: Swagger Inaccessible',
          message: 'The swagger.json file is no longer accessible',
          project: 'UI_Project',
          changeType: 'endpoint_updated',
          fieldName: 'swagger.json',
        });
        return;
      }

      const diff = _diffSwagger(cachedSwagger || {}, result.data);

      if (hasChanges(diff)) {
        // Requirement 6.6: accumulate changes if prompt is pending
        cumulativeChanges = mergeDiffs(cumulativeChanges, diff);

        const summary = formatChangeSummary(cumulativeChanges);
        const fieldName = getPrimaryFieldName(cumulativeChanges);

        _sendNotification({
          title: 'UI_Project: Change Detected',
          message: `Swagger changes detected: ${summary}`,
          project: 'UI_Project',
          changeType: 'endpoint_updated',
          fieldName: fieldName,
        });

        // Requirement 6.6: if prompt is already pending, skip new prompt
        // (cumulative changes are already accumulated and will show when next prompt fires)
        if (promptPending) {
          return;
        }

        // Mark prompt as pending and ask for approval
        promptPending = true;

        const promptMessage = `\nUI_Project: Swagger changes detected.\n${summary}\nApply UI update?`;

        _askApproval(promptMessage).then(async (approved) => {
          if (approved) {
            console.log('Update approved — performing self-healing update...');
            const fieldsToAdd = [...cumulativeChanges.addedFields];
            const fieldsToRemove = [...cumulativeChanges.removedFields];
            const success = await _performSelfHealingUpdate(fieldsToAdd, fieldsToRemove);
            if (success) {
              console.log('Self-healing update completed successfully.');
            } else {
              console.log('Self-healing update failed. Changes reverted.');
            }
          } else {
            console.log('Update rejected');
          }
          _clearPendingPrompt();
        });
      }

      // Update cached swagger regardless of diff results
      cachedSwagger = result.data;
    },

    onError: (error) => {
      _sendNotification({
        title: 'UI_Project: Swagger Inaccessible',
        message: 'The swagger.json file is no longer accessible',
        project: 'UI_Project',
        changeType: 'endpoint_updated',
        fieldName: 'swagger.json',
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

    /**
     * Returns the current cumulative changes since last prompt clearance.
     * @returns {Object} { addedFields, removedFields, modifiedFields }
     */
    getCumulativeChanges() {
      return { ...cumulativeChanges };
    },

    /**
     * Returns whether an approval prompt is currently pending.
     * @returns {boolean}
     */
    isPromptPending() {
      return promptPending;
    },

    /**
     * Clears the pending prompt state and resets cumulative changes.
     * Called after developer approves or rejects.
     */
    clearPendingPrompt() {
      _clearPendingPrompt();
    },

    /**
     * Sets the prompt pending state (used by approval prompt logic).
     * @param {boolean} pending
     */
    setPendingPrompt(pending) {
      promptPending = pending;
    },
  };
}

module.exports = {
  start,
  readSwagger,
  mergeDiffs,
  hasChanges,
  formatChangeSummary,
  getPrimaryFieldName,
  SWAGGER_PATH,
  POLLING_INTERVAL,
};

// If run directly, start the loop and log
if (require.main === module) {
  const handle = start();
  console.log('UI agentic loop is running. Watching for swagger changes...');
  console.log(`Watching: ${SWAGGER_PATH}`);

  // Graceful shutdown on SIGINT/SIGTERM
  process.on('SIGINT', async () => {
    console.log('\nStopping UI agentic loop...');
    await handle.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await handle.stop();
    process.exit(0);
  });
}
