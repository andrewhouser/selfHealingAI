import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Feature: agentic-api-contract-demo, Property 1: Schema persistence round-trip
 *
 * For any valid field definition (with a random field name and type), adding it to
 * the schema object, writing the schema to disk, and then reading the file back
 * should produce a schema object containing that field with the same name, type,
 * and required status.
 *
 * Validates: Requirements 1.3
 */
describe('Feature: agentic-api-contract-demo, Property 1: Schema persistence round-trip', () => {
  const tmpDirs = [];

  afterEach(() => {
    // Clean up temp directories
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {
        // ignore cleanup errors
      }
    }
    tmpDirs.length = 0;
  });

  // Generate valid field names: alphanumeric strings starting with a letter
  const fieldNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/);

  // Generate field types from the supported set
  const fieldTypeArb = fc.constantFrom('string', 'number', 'boolean', 'integer');

  // Generate required status
  const requiredArb = fc.boolean();

  // Base schema matching the database-project format
  const baseSchema = {
    type: 'object',
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      address: { type: 'string', required: true },
      phone_number: { type: 'string', required: true },
    },
  };

  it('adding a field to schema, writing to disk, and reading back preserves the field name, type, and required status', () => {
    /** Validates: Requirements 1.3 */
    fc.assert(
      fc.property(fieldNameArb, fieldTypeArb, requiredArb, (fieldName, fieldType, required) => {
        // Create a temp directory for this iteration
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-roundtrip-'));
        tmpDirs.push(tmpDir);
        const schemaPath = path.join(tmpDir, 'schema.json');

        // Start with a deep copy of the base schema
        const schema = JSON.parse(JSON.stringify(baseSchema));

        // Add the generated field
        schema.fields[fieldName] = { type: fieldType, required };

        // Write to disk
        fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf-8');

        // Read back from disk
        const readBack = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

        // Verify the field exists with same name, type, and required status
        expect(readBack.fields[fieldName]).toBeDefined();
        expect(readBack.fields[fieldName].type).toBe(fieldType);
        expect(readBack.fields[fieldName].required).toBe(required);
      }),
      { numRuns: 100 }
    );
  });

  it('schema structure is preserved through round-trip for any generated field', () => {
    /** Validates: Requirements 1.3 */
    fc.assert(
      fc.property(fieldNameArb, fieldTypeArb, requiredArb, (fieldName, fieldType, required) => {
        // Create a temp directory for this iteration
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-roundtrip-'));
        tmpDirs.push(tmpDir);
        const schemaPath = path.join(tmpDir, 'schema.json');

        // Start with a deep copy of the base schema
        const schema = JSON.parse(JSON.stringify(baseSchema));

        // Add the generated field
        schema.fields[fieldName] = { type: fieldType, required };

        // Write to disk
        fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf-8');

        // Read back from disk
        const readBack = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

        // Verify the overall schema structure is intact
        expect(readBack.type).toBe('object');
        expect(readBack.fields).toBeDefined();

        // Verify all original fields are still present
        expect(readBack.fields.name).toEqual({ type: 'string', required: true });
        expect(readBack.fields.email).toEqual({ type: 'string', required: true });
        expect(readBack.fields.address).toEqual({ type: 'string', required: true });
        expect(readBack.fields.phone_number).toEqual({ type: 'string', required: true });

        // Verify the new field is present and correct
        expect(readBack.fields[fieldName]).toEqual({ type: fieldType, required });
      }),
      { numRuns: 100 }
    );
  });
});
