const chokidar = require('chokidar');

/**
 * Maximum allowed polling interval in milliseconds.
 * Per requirements, file-system polling must occur at intervals no greater than 2 seconds.
 */
const MAX_POLLING_INTERVAL = 2000;

/**
 * Default polling interval in milliseconds.
 */
const DEFAULT_POLLING_INTERVAL = 1000;

/**
 * Creates a file watcher that monitors a single file for changes using chokidar with polling.
 *
 * @param {string} filePath - The absolute or relative path to the file to watch
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.interval=1000] - Polling interval in ms (clamped to max 2000ms)
 * @param {function} [options.onChange] - Callback invoked with (filePath) when the file changes
 * @param {function} [options.onError] - Callback invoked with (error) on watcher errors
 * @returns {{ close: function(): Promise<void> }} Object with close() method to stop watching
 */
function createFileWatcher(filePath, options = {}) {
  const interval = Math.min(
    Math.max(options.interval || DEFAULT_POLLING_INTERVAL, 1),
    MAX_POLLING_INTERVAL
  );

  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const onError = typeof options.onError === 'function' ? options.onError : () => {};

  const watcher = chokidar.watch(filePath, {
    usePolling: true,
    interval,
    persistent: true,
    ignoreInitial: true,
    // Continue watching even if the file is deleted — it may reappear
    disableGlobbing: true,
    alwaysStat: true,
  });

  watcher.on('change', (changedPath) => {
    onChange(changedPath);
  });

  watcher.on('unlink', () => {
    // File was deleted — chokidar with usePolling will continue watching
    // for the file to reappear. No action needed; just don't crash.
  });

  watcher.on('error', (error) => {
    onError(error);
  });

  return {
    /**
     * Stops the file watcher and releases resources.
     * @returns {Promise<void>}
     */
    close() {
      return watcher.close();
    },
  };
}

module.exports = {
  createFileWatcher,
  MAX_POLLING_INTERVAL,
  DEFAULT_POLLING_INTERVAL,
};
