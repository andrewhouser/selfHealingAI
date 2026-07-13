import { describe, it, expect } from 'vitest';
import {
  resolvePath,
  computeFieldsDiff,
  diffContract,
  hasChanges,
  summarizeChange,
  contractsEqual,
} from './contract-diff.js';

const schemaBefore = {
  type: 'object',
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
  },
};

const swaggerBefore = {
  components: { schemas: { Person: { properties: { name: { type: 'string' }, email: { type: 'string' } } } } },
};

describe('resolvePath', () => {
  it('drills into a nested path', () => {
    expect(resolvePath(schemaBefore, ['fields'])).toHaveProperty('name');
    expect(resolvePath(swaggerBefore, ['components', 'schemas', 'Person', 'properties'])).toHaveProperty('email');
  });

  it('returns {} for a missing path segment', () => {
    expect(resolvePath(schemaBefore, ['nope', 'deeper'])).toEqual({});
    expect(resolvePath(null, ['fields'])).toEqual({});
  });
});

describe('computeFieldsDiff', () => {
  it('detects added, removed, and modified fields', () => {
    const oldFields = { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } };
    const newFields = { a: { type: 'string' }, b: { type: 'number' }, d: { type: 'string' } };
    const diff = computeFieldsDiff(oldFields, newFields);
    expect(diff.addedFields).toEqual(['d']);
    expect(diff.removedFields).toEqual(['c']);
    expect(diff.modifiedFields).toEqual(['b']);
  });

  it('flags a required-status change as modified', () => {
    const diff = computeFieldsDiff(
      { a: { type: 'string', required: false } },
      { a: { type: 'string', required: true } }
    );
    expect(diff.modifiedFields).toEqual(['a']);
  });
});

describe('diffContract', () => {
  it('works generically across schema and swagger shapes via contractPath', () => {
    const schemaAfter = {
      ...schemaBefore,
      fields: { ...schemaBefore.fields, age: { type: 'number' } },
    };
    const schemaDiff = diffContract(schemaBefore, schemaAfter, ['fields']);
    expect(schemaDiff.addedFields).toContain('age');

    const swaggerAfter = {
      components: { schemas: { Person: { properties: { name: { type: 'string' } } } } },
    };
    const swaggerDiff = diffContract(swaggerBefore, swaggerAfter, ['components', 'schemas', 'Person', 'properties']);
    expect(swaggerDiff.removedFields).toContain('email');
  });
});

describe('summarizeChange / hasChanges', () => {
  it('summarizes a mixed diff into a readable line', () => {
    const diff = { addedFields: ['age'], removedFields: ['nickname'], modifiedFields: ['email'] };
    expect(hasChanges(diff)).toBe(true);
    expect(summarizeChange(diff)).toBe('Added: age; Removed: nickname; Modified: email');
  });

  it('reports no changes for an empty diff', () => {
    const diff = { addedFields: [], removedFields: [], modifiedFields: [] };
    expect(hasChanges(diff)).toBe(false);
    expect(summarizeChange(diff)).toBe('');
  });
});

describe('contractsEqual', () => {
  it('is true for deeply equal contracts regardless of reference', () => {
    expect(contractsEqual(schemaBefore, JSON.parse(JSON.stringify(schemaBefore)))).toBe(true);
  });

  it('detects nested changes with no field vocabulary (e.g. type change)', () => {
    const changed = { ...schemaBefore, fields: { ...schemaBefore.fields, name: { type: 'number', required: true } } };
    expect(contractsEqual(schemaBefore, changed)).toBe(false);
  });

  it('detects key add/remove and array differences', () => {
    expect(contractsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(contractsEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(contractsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
