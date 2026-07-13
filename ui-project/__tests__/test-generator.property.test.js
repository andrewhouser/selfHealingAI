import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { generateFieldTest } = require('../test-generator.js');

/**
 * Feature: agentic-api-contract-demo, Property 8: Test generation references new field
 *
 * For any valid field name string, the test generator should produce test code that asserts
 * the presence of a table column or cell containing data for that field name.
 *
 * Validates: Requirements 7.2
 */
describe('Feature: agentic-api-contract-demo, Property 8: Test generation references new field', () => {
  // Generate valid JavaScript identifiers: starts with lowercase letter, followed by alphanumeric or underscore
  const validFieldNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,20}$/);

  it('generateFieldTest produces test code containing the field name for any valid identifier', () => {
    /** Validates: Requirements 7.2 */
    fc.assert(
      fc.property(validFieldNameArb, (fieldName) => {
        const testCode = generateFieldTest(fieldName);

        // The generated test code must contain the field name
        expect(testCode).toContain(fieldName);
      }),
      { numRuns: 100 }
    );
  });

  it('generateFieldTest produces test code referencing PersonTable for any valid identifier', () => {
    /** Validates: Requirements 7.2 */
    fc.assert(
      fc.property(validFieldNameArb, (fieldName) => {
        const testCode = generateFieldTest(fieldName);

        // The generated test code must reference the PersonTable component
        expect(testCode).toContain('PersonTable');
      }),
      { numRuns: 100 }
    );
  });

  it('generateFieldTest produces test code with assertions for any valid identifier', () => {
    /** Validates: Requirements 7.2 */
    fc.assert(
      fc.property(validFieldNameArb, (fieldName) => {
        const testCode = generateFieldTest(fieldName);

        // The generated test code must contain assertion keywords
        expect(testCode).toContain('expect');
        expect(testCode).toContain('toBeInTheDocument');
      }),
      { numRuns: 100 }
    );
  });
});
