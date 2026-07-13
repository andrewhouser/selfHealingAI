'use strict';

/**
 * UI agentic loop — thin entry point.
 *
 * All behavior lives in the generic loop (shared/agentic-loop.js) driven by the
 * "ui" node in contracts.config.json. This file only resolves that node and
 * starts it, plus handles process lifecycle when run directly.
 */

const { getNode } = require('../shared/registry');
const { startNode } = require('../shared/agentic-loop');

const NODE_ID = 'ui';

/**
 * Starts the UI node's agentic loop.
 * @param {Object} [deps] - Optional dependency overrides (for testing)
 * @returns {{ stop: function(): Promise<void> }}
 */
function start(deps = {}) {
  const node = deps.node || getNode(NODE_ID);
  return startNode(node, deps);
}

module.exports = { start, NODE_ID };

// If run directly, start the loop.
if (require.main === module) {
  const node = getNode(NODE_ID);
  const handle = start();
  console.log('UI agentic loop is running. Watching for contract changes...');
  console.log(`Watching: ${node.consumesPath}`);

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
