'use strict';

/**
 * Generic contract diff.
 *
 * Compares two contract documents at a configured path and reports which fields
 * were added, removed, or modified. Unlike the old diff-schema.js, this is not
 * tied to a specific document shape (schema vs. swagger) — the caller supplies
 * the path to the field-set object, so any JSON contract works.
 *
 * The reconcile loop does NOT consume this diff (it receives the whole before/after
 * contract). This exists only for two things:
 *   1. the human-facing change summary shown in notifications and approval prompts, and
 *   2. the "did anything actually change" gate (see contractsEqual).
 *
 * @typedef {Object} FieldsDiff
 * @property {string[]} addedFields
 * @property {string[]} removedFields
 * @property {string[]} modifiedFields
 */

/**
 * Drills into an object following an array of keys.
 * Returns {} if any segment is missing, so callers can treat "absent" as "empty".
 *
 * @param {Object} obj
 * @param {string[]} pathArray
 * @returns {Object}
 */
function resolvePath(obj, pathArray) {
  let current = obj;
  for (const key of pathArray || []) {
    if (current == null || typeof current !== 'object') return {};
    current = current[key];
  }
  return current && typeof current === 'object' ? current : {};
}

/**
 * A field is "modified" if its type or required status changed.
 * @param {Object} oldField
 * @param {Object} newField
 * @returns {boolean}
 */
function isFieldModified(oldField, newField) {
  if (!oldField || !newField) return false;
  if (oldField.type !== newField.type) return true;
  const oldRequired = oldField.required === true;
  const newRequired = newField.required === true;
  return oldRequired !== newRequired;
}

/**
 * Compute the diff between two field-definition maps.
 *
 * @param {Object} oldFields - Map of field name to field definition (old)
 * @param {Object} newFields - Map of field name to field definition (new)
 * @returns {FieldsDiff}
 */
function computeFieldsDiff(oldFields, newFields) {
  const oldKeys = Object.keys(oldFields || {});
  const newKeys = Object.keys(newFields || {});
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);

  return {
    addedFields: newKeys.filter((key) => !oldSet.has(key)),
    removedFields: oldKeys.filter((key) => !newSet.has(key)),
    modifiedFields: oldKeys.filter(
      (key) => newSet.has(key) && isFieldModified((oldFields || {})[key], (newFields || {})[key])
    ),
  };
}

/**
 * Diff two contract documents at the given field-set path.
 *
 * @param {Object} oldContract
 * @param {Object} newContract
 * @param {string[]} pathArray - e.g. ['fields'] or ['components','schemas','Person','properties']
 * @returns {FieldsDiff}
 */
function diffContract(oldContract, newContract, pathArray) {
  return computeFieldsDiff(
    resolvePath(oldContract, pathArray),
    resolvePath(newContract, pathArray)
  );
}

/**
 * Whether a FieldsDiff carries any change.
 * @param {FieldsDiff} diff
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
 * Human-readable one-line summary of a diff, e.g. "Added: age; Removed: nickname".
 * @param {FieldsDiff} diff
 * @returns {string}
 */
function summarizeChange(diff) {
  const parts = [];
  if (diff.addedFields.length > 0) parts.push(`Added: ${diff.addedFields.join(', ')}`);
  if (diff.removedFields.length > 0) parts.push(`Removed: ${diff.removedFields.join(', ')}`);
  if (diff.modifiedFields.length > 0) parts.push(`Modified: ${diff.modifiedFields.join(', ')}`);
  return parts.join('; ');
}

/**
 * Deep structural equality for two contract documents. Used to decide whether a
 * file-change event actually altered the contract — no field vocabulary required,
 * so it catches any kind of change (rename, type change, nested reshape).
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function contractsEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) return false;

  if (aArray) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => contractsEqual(item, b[i]));
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && contractsEqual(a[key], b[key]));
}

module.exports = {
  resolvePath,
  computeFieldsDiff,
  diffContract,
  hasChanges,
  summarizeChange,
  contractsEqual,
  isFieldModified,
};
