import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { mergeDiffs } = require('../agentic-loop.js');

/**
 * Feature: agentic-api-contract-demo, Property 6: Cumulative swagger changes consolidate into single prompt
 *
 * For any sequence of 2 or more swagger document changes arriving before developer approval,
 * the UI agentic loop should present a single prompt whose diff summary includes all fields
 * from all intermediate changes, equivalent to a diff between the original swagger and the
 * latest version.
 *
 * Validates: Requirements 6.6
 */
describe('Feature: agentic-api-contract-demo, Property 6: Cumulative swagger changes consolidate into single prompt', () => {
  // Generate non-empty field name strings (valid identifier-like names)
  const fieldNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,15}$/);

  // Generate a non-empty array of unique field names
  const fieldNamesArb = fc.uniqueArray(fieldNameArb, { minLength: 1, maxLength: 5 });

  // Generate a single SchemaDiff with random non-empty field arrays
  const schemaDiffArb = fc.record({
    addedFields: fieldNamesArb,
    removedFields: fieldNamesArb,
    modifiedFields: fieldNamesArb,
  });

  // Generate a sequence of 2-5 SchemaDiff objects
  const diffSequenceArb = fc.array(schemaDiffArb, { minLength: 2, maxLength: 5 });

  it('merging a sequence of diffs produces a cumulative result containing ALL unique field names from ALL diffs in each category', () => {
    /** Validates: Requirements 6.6 */
    fc.assert(
      fc.property(diffSequenceArb, (diffs) => {
        // Start with empty cumulative
        let cumulative = { addedFields: [], removedFields: [], modifiedFields: [] };

        // Merge each diff sequentially
        for (const diff of diffs) {
          cumulative = mergeDiffs(cumulative, diff);
        }

        // Collect expected unique field names from all diffs in each category
        const expectedAdded = [...new Set(diffs.flatMap((d) => d.addedFields))];
        const expectedRemoved = [...new Set(diffs.flatMap((d) => d.removedFields))];
        const expectedModified = [...new Set(diffs.flatMap((d) => d.modifiedFields))];

        // Verify the final cumulative contains ALL unique field names from ALL diffs
        for (const field of expectedAdded) {
          expect(cumulative.addedFields).toContain(field);
        }
        for (const field of expectedRemoved) {
          expect(cumulative.removedFields).toContain(field);
        }
        for (const field of expectedModified) {
          expect(cumulative.modifiedFields).toContain(field);
        }

        // Verify no extra fields were introduced (cumulative should be exactly the union)
        expect(cumulative.addedFields.length).toBe(expectedAdded.length);
        expect(cumulative.removedFields.length).toBe(expectedRemoved.length);
        expect(cumulative.modifiedFields.length).toBe(expectedModified.length);
      }),
      { numRuns: 100 }
    );
  });

  it('merging any sequence of diffs is equivalent to merging the union of all diffs at once', () => {
    /** Validates: Requirements 6.6 */
    fc.assert(
      fc.property(diffSequenceArb, (diffs) => {
        // Sequential merge
        let sequential = { addedFields: [], removedFields: [], modifiedFields: [] };
        for (const diff of diffs) {
          sequential = mergeDiffs(sequential, diff);
        }

        // Single merge of all fields combined
        const combinedDiff = {
          addedFields: diffs.flatMap((d) => d.addedFields),
          removedFields: diffs.flatMap((d) => d.removedFields),
          modifiedFields: diffs.flatMap((d) => d.modifiedFields),
        };
        const singleMerge = mergeDiffs(
          { addedFields: [], removedFields: [], modifiedFields: [] },
          combinedDiff
        );

        // Both approaches should produce the same unique sets
        expect(new Set(sequential.addedFields)).toEqual(new Set(singleMerge.addedFields));
        expect(new Set(sequential.removedFields)).toEqual(new Set(singleMerge.removedFields));
        expect(new Set(sequential.modifiedFields)).toEqual(new Set(singleMerge.modifiedFields));
      }),
      { numRuns: 100 }
    );
  });

  it('cumulative result always has non-empty fields when input sequence has non-empty diffs', () => {
    /** Validates: Requirements 6.6 */
    fc.assert(
      fc.property(diffSequenceArb, (diffs) => {
        let cumulative = { addedFields: [], removedFields: [], modifiedFields: [] };
        for (const diff of diffs) {
          cumulative = mergeDiffs(cumulative, diff);
        }

        // Since each diff has non-empty arrays in all categories, cumulative must too
        expect(cumulative.addedFields.length).toBeGreaterThan(0);
        expect(cumulative.removedFields.length).toBeGreaterThan(0);
        expect(cumulative.modifiedFields.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
