import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { generateSwaggerFromSchema } = require('./swagger-generator');

/**
 * Feature: agentic-api-contract-demo, Property 2: Swagger generation includes all Person fields
 *
 * For any set of Person_Record fields defined in the schema, the swagger generator
 * should produce a Swagger document whose components.schemas.Person.properties object
 * contains an entry for every field in the schema, with no extra or missing fields,
 * and each property has the correct type.
 *
 * Validates: Requirements 2.2, 5.2
 */
describe('Feature: agentic-api-contract-demo, Property 2: Swagger generation includes all Person fields', () => {
  // Generate valid field names: lowercase letter followed by alphanumeric/underscores
  const fieldNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/);

  // Generate field types from the supported set
  const fieldTypeArb = fc.constantFrom('string', 'number', 'boolean', 'integer');

  // Generate a single field definition
  const fieldDefArb = fc.record({
    type: fieldTypeArb,
    required: fc.boolean(),
  });

  // Generate a non-empty set of field definitions (1 to 10 fields)
  const fieldSetArb = fc
    .uniqueArray(fieldNameArb, { minLength: 1, maxLength: 10 })
    .chain((names) =>
      fc.tuple(
        fc.constant(names),
        fc.array(fieldDefArb, { minLength: names.length, maxLength: names.length })
      )
    )
    .map(([names, defs]) => {
      const fields = {};
      for (let i = 0; i < names.length; i++) {
        fields[names[i]] = defs[i];
      }
      return fields;
    });

  it('swagger Person schema contains exactly the same field names as the input schema', () => {
    /** Validates: Requirements 2.2, 5.2 */
    fc.assert(
      fc.property(fieldSetArb, (fields) => {
        const schema = { type: 'object', fields };

        const swagger = generateSwaggerFromSchema(schema);

        const personProperties = swagger.components.schemas.Person.properties;
        const swaggerFieldNames = Object.keys(personProperties).sort();
        const inputFieldNames = Object.keys(fields).sort();

        // Exactly the same fields — no extra, no missing
        expect(swaggerFieldNames).toEqual(inputFieldNames);
      }),
      { numRuns: 100 }
    );
  });

  it('swagger Person schema has correct type for each field', () => {
    /** Validates: Requirements 2.2, 5.2 */
    fc.assert(
      fc.property(fieldSetArb, (fields) => {
        const schema = { type: 'object', fields };

        const swagger = generateSwaggerFromSchema(schema);

        const personProperties = swagger.components.schemas.Person.properties;

        // Each field type in the swagger output matches the input schema type
        for (const [fieldName, fieldDef] of Object.entries(fields)) {
          expect(personProperties[fieldName]).toBeDefined();
          expect(personProperties[fieldName].type).toBe(fieldDef.type);
        }
      }),
      { numRuns: 100 }
    );
  });
});
