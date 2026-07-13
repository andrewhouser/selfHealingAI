import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { render } from '@testing-library/react';
import { PersonTable } from '../components/PersonTable';

/**
 * Feature: agentic-api-contract-demo, Property 3: Table component renders one column per field
 *
 * For any non-empty set of Person_Record field names, rendering the PersonTable component
 * with those fields should produce a table element containing exactly one column header
 * per field name, where each header text matches a field name.
 *
 * Validates: Requirements 3.1
 */
describe('Feature: agentic-api-contract-demo, Property 3: Table component renders one column per field', () => {
  // Generate valid field names: lowercase letter followed by alphanumeric/underscores
  const fieldNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,15}$/);

  // PersonTable humanizes column headers for display (snake_case -> words), so a
  // field named "phone_number" renders as "phone number". Headers must be compared
  // against the field name run through the same transform. This mapping is injective
  // over the allowed field charset (field names contain no spaces), so distinct
  // fields still produce distinct headers.
  const toHeader = (field: string) => field.replaceAll('_', ' ');

  // Generate a non-empty array of unique field names (1-10 fields)
  const fieldSetArb = fc.uniqueArray(fieldNameArb, { minLength: 1, maxLength: 10 });

  // Generate random data rows matching a given set of fields
  const dataRowArb = (fields: string[]) =>
    fc.record(
      Object.fromEntries(fields.map((f) => [f, fc.string({ minLength: 0, maxLength: 20 })]))
    ) as fc.Arbitrary<Record<string, string>>;

  // Generate 0-5 data rows for a given set of fields
  const dataArb = (fields: string[]) =>
    fc.array(dataRowArb(fields), { minLength: 0, maxLength: 5 });

  it('renders exactly one column header per field name', () => {
    /** Validates: Requirements 3.1 */
    fc.assert(
      fc.property(
        fieldSetArb.chain((fields) =>
          dataArb(fields).map((data) => ({ fields, data }))
        ),
        ({ fields, data }) => {
          const { container } = render(
            <PersonTable fields={fields} data={data} />
          );

          const columnHeaders = container.querySelectorAll('[role="columnheader"]');

          // Exactly one column header per field
          expect(columnHeaders.length).toBe(fields.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each column header text matches a field name', () => {
    /** Validates: Requirements 3.1 */
    fc.assert(
      fc.property(
        fieldSetArb.chain((fields) =>
          dataArb(fields).map((data) => ({ fields, data }))
        ),
        ({ fields, data }) => {
          const { container } = render(
            <PersonTable fields={fields} data={data} />
          );

          const columnHeaders = container.querySelectorAll('[role="columnheader"]');
          const headerTexts = Array.from(columnHeaders).map(
            (header) => header.textContent
          );
          const expectedHeaders = fields.map(toHeader);

          // Every field appears as a column header (in its humanized form)
          for (const field of fields) {
            expect(headerTexts).toContain(toHeader(field));
          }

          // Every column header corresponds to a field (no extra headers)
          for (const text of headerTexts) {
            expect(expectedHeaders).toContain(text);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
