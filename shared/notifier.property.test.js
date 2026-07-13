import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatTitle, formatMessage, CHANGE_TYPE_DESCRIPTIONS } from './notifier.js';

/**
 * Feature: agentic-api-contract-demo, Property 4: Notification formatting correctness
 *
 * For any project name (from the set Database_Project, API_Project, UI_Project),
 * any change type (field_added, endpoint_updated, component_modified), and any
 * non-empty field name string, the notification builder should produce a notification
 * whose title contains the project name and whose body contains both the change type
 * description and the field name.
 *
 * Validates: Requirements 4.3, 6.3, 8.3, 9.2, 9.3
 */
describe('Feature: agentic-api-contract-demo, Property 4: Notification formatting correctness', () => {
  const projectNames = ['Database_Project', 'API_Project', 'UI_Project'];
  const changeTypes = ['field_added', 'endpoint_updated', 'component_modified'];

  const projectArb = fc.constantFrom(...projectNames);
  const changeTypeArb = fc.constantFrom(...changeTypes);
  // Generate non-empty field names that resemble valid identifiers
  const fieldNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

  it('formatTitle contains the project name for any valid project', () => {
    /** Validates: Requirements 4.3, 6.3, 8.3, 9.2, 9.3 */
    fc.assert(
      fc.property(projectArb, (project) => {
        const title = formatTitle(project);
        expect(title).toContain(project);
      }),
      { numRuns: 100 }
    );
  });

  it('formatMessage contains the field name for any valid inputs', () => {
    /** Validates: Requirements 4.3, 6.3, 8.3, 9.2, 9.3 */
    fc.assert(
      fc.property(changeTypeArb, fieldNameArb, (changeType, fieldName) => {
        const message = formatMessage(changeType, fieldName);
        expect(message).toContain(fieldName);
      }),
      { numRuns: 100 }
    );
  });

  it('formatMessage contains the change type description for any valid inputs', () => {
    /** Validates: Requirements 4.3, 6.3, 8.3, 9.2, 9.3 */
    fc.assert(
      fc.property(changeTypeArb, fieldNameArb, (changeType, fieldName) => {
        const message = formatMessage(changeType, fieldName);
        const expectedDescription = CHANGE_TYPE_DESCRIPTIONS[changeType];
        expect(message).toContain(expectedDescription);
      }),
      { numRuns: 100 }
    );
  });

  it('formatTitle and formatMessage produce correct notification content for any combination', () => {
    /** Validates: Requirements 4.3, 6.3, 8.3, 9.2, 9.3 */
    fc.assert(
      fc.property(projectArb, changeTypeArb, fieldNameArb, (project, changeType, fieldName) => {
        const title = formatTitle(project);
        const message = formatMessage(changeType, fieldName);

        // Title must contain the project name (Req 9.2)
        expect(title).toContain(project);

        // Body must contain the change type description (Req 9.3)
        const expectedDescription = CHANGE_TYPE_DESCRIPTIONS[changeType];
        expect(message).toContain(expectedDescription);

        // Body must contain the field name (Req 9.3)
        expect(message).toContain(fieldName);
      }),
      { numRuns: 100 }
    );
  });
});
