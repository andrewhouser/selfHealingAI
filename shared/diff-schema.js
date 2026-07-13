'use strict';

/**
 * Schema/Swagger diff utility.
 *
 * Compares two schema objects and returns a SchemaDiff describing
 * which fields were added, removed, or modified.
 *
 * @typedef {Object} SchemaDiff
 * @property {string[]} addedFields   - Fields present in new but not old
 * @property {string[]} removedFields - Fields present in old but not new
 * @property {string[]} modifiedFields - Fields present in both but with changed type or required status
 */

/**
 * Compare two field definition objects and determine if they differ.
 * A field is considered modified if its `type` or `required` status changed.
 *
 * @param {Object} oldField - Old field definition
 * @param {Object} newField - New field definition
 * @returns {boolean} True if the field was modified
 */
function isFieldModified(oldField, newField) {
  if (!oldField || !newField) return false;

  // Compare type
  if (oldField.type !== newField.type) return true;

  // Compare required status (normalize undefined to false)
  const oldRequired = oldField.required === true;
  const newRequired = newField.required === true;
  if (oldRequired !== newRequired) return true;

  return false;
}

/**
 * Compute the diff between two sets of field definitions.
 *
 * @param {Object} oldFields - Map of field name to field definition (old version)
 * @param {Object} newFields - Map of field name to field definition (new version)
 * @returns {SchemaDiff}
 */
function computeFieldsDiff(oldFields, newFields) {
  const oldKeys = Object.keys(oldFields || {});
  const newKeys = Object.keys(newFields || {});

  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);

  const addedFields = newKeys.filter((key) => !oldSet.has(key));
  const removedFields = oldKeys.filter((key) => !newSet.has(key));
  const modifiedFields = oldKeys.filter(
    (key) => newSet.has(key) && isFieldModified(oldFields[key], newFields[key])
  );

  return { addedFields, removedFields, modifiedFields };
}

/**
 * Compare two database schema objects and return a SchemaDiff.
 *
 * Database schema format:
 * {
 *   "type": "object",
 *   "fields": {
 *     "name": { "type": "string", "required": true },
 *     ...
 *   }
 * }
 *
 * @param {Object} oldSchema - Previous schema object
 * @param {Object} newSchema - Updated schema object
 * @returns {SchemaDiff}
 */
function diffSchema(oldSchema, newSchema) {
  const oldFields = (oldSchema && oldSchema.fields) || {};
  const newFields = (newSchema && newSchema.fields) || {};
  return computeFieldsDiff(oldFields, newFields);
}

/**
 * Compare two OpenAPI/Swagger documents and return a SchemaDiff
 * for the Person schema's properties.
 *
 * Swagger format:
 * {
 *   "components": {
 *     "schemas": {
 *       "Person": {
 *         "type": "object",
 *         "properties": {
 *           "name": { "type": "string" },
 *           ...
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * @param {Object} oldSwagger - Previous swagger document
 * @param {Object} newSwagger - Updated swagger document
 * @returns {SchemaDiff}
 */
function diffSwagger(oldSwagger, newSwagger) {
  const oldProperties =
    (oldSwagger &&
      oldSwagger.components &&
      oldSwagger.components.schemas &&
      oldSwagger.components.schemas.Person &&
      oldSwagger.components.schemas.Person.properties) ||
    {};
  const newProperties =
    (newSwagger &&
      newSwagger.components &&
      newSwagger.components.schemas &&
      newSwagger.components.schemas.Person &&
      newSwagger.components.schemas.Person.properties) ||
    {};
  return computeFieldsDiff(oldProperties, newProperties);
}

module.exports = { diffSchema, diffSwagger };
