'use strict';

/**
 * Generic agentic loop.
 *
 * One implementation, instantiated per node from the contract registry. It watches
 * the node's consumed contract, and on a real change it:
 *
 *   detect → notify → ask approval → reconcile owned source → run producer (cascade)
 *
 * Nothing here knows about "fields", "swagger", "columns", or "add vs remove". It
 * works on whole contracts and delegates the actual code change to the generic
 * reconcile engine. A new consumer is wired up by adding a node to the registry
 * and calling startNode(node) — no new loop code.
 */

const fs = require('fs');

const { createFileWatcher } = require('./file-watcher');
const { sendNotification } = require('./notifier');
const { contractsEqual, diffContract, summarizeChange } = require('./contract-diff');
const { askApproval: defaultAskApproval } = require('./approval-prompt');
const { reconcileNode: defaultReconcileNode } = require('./reconcile');

const POLLING_INTERVAL = 1000; // 1 second, within the 2-second max

/**
 * Reads and parses a JSON contract file.
 *
 * @param {string} filePath
 * @param {function} [readFileFn] - injectable reader
 * @returns {{ data: Object|null, parseError: boolean }}
 */
function readContract(filePath, readFileFn) {
  const _read = readFileFn || ((p) => fs.readFileSync(p, 'utf-8'));
  try {
    return { data: JSON.parse(_read(filePath)), parseError: false };
  } catch (err) {
    // Missing/inaccessible file is not a parse error; malformed JSON is.
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      return { data: null, parseError: false };
    }
    return { data: null, parseError: true };
  }
}

/**
 * Runs a node's deterministic producer (e.g. regenerate swagger.json from schema).
 * The producer's write is what cascades the change to the downstream node's watcher.
 *
 * @param {Object} node - Hydrated registry node
 * @returns {*} whatever the producer returns
 */
function runProducer(node) {
  if (!node.producer) return undefined;
  const { module: modulePath, export: exportName } = node.producer;
  // Resolve the producer module relative to the repo root via the registry helper.
  const { resolveFromRoot } = require('./registry');
  const mod = require(resolveFromRoot(modulePath));
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    throw new Error(`Producer ${modulePath}#${exportName} is not a function`);
  }
  return fn();
}

/**
 * Starts the agentic loop for a single node.
 *
 * @param {Object} node - Hydrated registry node
 * @param {Object} [deps] - Injectable dependencies (for testing)
 * @param {function} [deps.createFileWatcher]
 * @param {function} [deps.sendNotification]
 * @param {function} [deps.readContractFn] - (filePath) => { data, parseError }
 * @param {function} [deps.askApproval]
 * @param {function} [deps.reconcileNode]
 * @param {function} [deps.runProducer]
 * @returns {{ stop: function(): Promise<void>, isPromptPending: function(): boolean, getCached: function(): Object }}
 */
function startNode(node, deps = {}) {
  const _createFileWatcher = deps.createFileWatcher || createFileWatcher;
  const _sendNotification = deps.sendNotification || sendNotification;
  const _readContract = deps.readContractFn || ((p) => readContract(p));
  const _askApproval = deps.askApproval || defaultAskApproval;
  const _reconcileNode = deps.reconcileNode || defaultReconcileNode;
  const _runProducer = deps.runProducer || runProducer;

  let cached = _readContract(node.consumesPath).data;
  let promptPending = false;

  const watcher = _createFileWatcher(node.consumesPath, {
    interval: POLLING_INTERVAL,

    onChange: async () => {
      const result = _readContract(node.consumesPath);

      if (result.parseError) {
        _sendNotification({
          title: `${node.project}: Contract Parse Error`,
          message: `${node.consumes} contains invalid JSON and could not be parsed`,
          project: node.project,
          changeType: 'contract_changed',
          fieldName: node.consumes,
        });
        return;
      }

      if (!result.data) {
        _sendNotification({
          title: `${node.project}: Contract Inaccessible`,
          message: `${node.consumes} is no longer accessible`,
          project: node.project,
          changeType: 'contract_changed',
          fieldName: node.consumes,
        });
        return;
      }

      const next = result.data;

      // The change gate: did the contract actually change? No field vocabulary needed.
      if (contractsEqual(cached, next)) {
        return;
      }

      const previous = cached;
      const diff = diffContract(previous || {}, next, node.contractPath);
      const summary = summarizeChange(diff) || 'contract changed';

      _sendNotification({
        title: `${node.project}: Change Detected`,
        message: `${node.consumes} changed — ${summary}`,
        project: node.project,
        changeType: 'contract_changed',
        fieldName: summary,
      });

      // If a prompt is already in flight, just fold in the new state and let the
      // pending cycle pick up the latest contract. Prevents prompt pile-ups.
      cached = next;
      if (promptPending) {
        return;
      }

      promptPending = true;
      try {
        const approved = await _askApproval(
          `${node.project}: ${node.consumes} changed (${summary}). Reconcile owned files?`
        );

        if (!approved) {
          console.log(`${node.project}: reconcile rejected. Continuing to watch...`);
          return;
        }

        console.log(`${node.project}: reconcile approved. Reconciling...`);
        const success = await _reconcileNode(node, previous || {}, cached);

        if (!success) {
          console.log(`${node.project}: reconcile failed and was reverted.`);
          return;
        }

        console.log(`${node.project}: reconcile succeeded.`);
        if (node.producer) {
          try {
            _runProducer(node);
            console.log(`${node.project}: regenerated ${node.produces}.`);
          } catch (err) {
            _sendNotification({
              title: `${node.project}: Producer Failed`,
              message: `Reconcile succeeded but regenerating ${node.produces} failed: ${err.message}`,
              project: node.project,
              changeType: 'contract_changed',
              fieldName: node.produces || '',
            });
          }
        }
      } finally {
        promptPending = false;
      }
    },

    onError: () => {
      _sendNotification({
        title: `${node.project}: Contract Inaccessible`,
        message: `${node.consumes} is no longer accessible`,
        project: node.project,
        changeType: 'contract_changed',
        fieldName: node.consumes,
      });
    },
  });

  return {
    stop() {
      return watcher.close();
    },
    isPromptPending() {
      return promptPending;
    },
    getCached() {
      return cached;
    },
  };
}

module.exports = { startNode, readContract, runProducer, POLLING_INTERVAL };
