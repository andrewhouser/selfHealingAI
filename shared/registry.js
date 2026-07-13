'use strict';

/**
 * Contract Registry
 *
 * Loads the declarative pipeline description from contracts.config.json and
 * exposes the participating nodes. A node describes *relationships*, never a
 * procedure:
 *
 *   - consumes      the upstream contract file it watches
 *   - contractPath  where the field set lives inside that contract (for human summaries)
 *   - owns          the source files the reconciler is allowed to edit
 *   - goal          a one-line natural-language invariant to maintain
 *   - producer      (optional) a deterministic { module, export } that regenerates...
 *   - produces      (optional) ...the downstream contract file this node outputs
 *   - verify        a shell command that must pass after a reconcile
 *
 * Adding a new consumer to the pipeline is a matter of adding a node here — no
 * new orchestration code.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, 'contracts.config.json');

/**
 * Resolves a repo-relative path (as written in the config) to an absolute path.
 * @param {string} relPath
 * @returns {string}
 */
function resolveFromRoot(relPath) {
  return path.isAbsolute(relPath) ? relPath : path.resolve(ROOT_DIR, relPath);
}

/**
 * Attaches absolute-path helpers to a raw node definition so callers never have
 * to know where the repo root is.
 *
 * @param {Object} node - Raw node object from the config file
 * @returns {Object} Node augmented with resolved absolute paths
 */
function hydrateNode(node) {
  return {
    ...node,
    consumesPath: node.consumes ? resolveFromRoot(node.consumes) : null,
    producesPath: node.produces ? resolveFromRoot(node.produces) : null,
    ownsPaths: (node.owns || []).map(resolveFromRoot),
    maxReconcileAttempts: node.maxReconcileAttempts || 2,
  };
}

/**
 * Loads and parses the contract registry.
 *
 * @param {string} [configPath] - Path to the config file (defaults to repo-root contracts.config.json)
 * @returns {{ nodes: Object[], getNode: function(string): Object }}
 */
function loadRegistry(configPath) {
  const target = configPath || DEFAULT_CONFIG_PATH;
  const raw = JSON.parse(fs.readFileSync(target, 'utf-8'));
  const nodes = (raw.nodes || []).map(hydrateNode);

  return {
    nodes,
    getNode(id) {
      const found = nodes.find((n) => n.id === id);
      if (!found) {
        throw new Error(`No node with id "${id}" in ${target}`);
      }
      return found;
    },
  };
}

/**
 * Convenience: load the default registry and return a single node by id.
 * @param {string} id
 * @param {string} [configPath]
 * @returns {Object}
 */
function getNode(id, configPath) {
  return loadRegistry(configPath).getNode(id);
}

module.exports = { loadRegistry, getNode, resolveFromRoot, ROOT_DIR, DEFAULT_CONFIG_PATH };
