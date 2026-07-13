import { describe, it, expect } from 'vitest';
import { diffSchema, diffSwagger } from './diff-schema.js';

describe('diffSchema', () => {
  it('returns empty diff when schemas are identical', () => {
    const schema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
      },
    };
    const result = diffSchema(schema, schema);
    expect(result.addedFields).toEqual([]);
    expect(result.removedFields).toEqual([]);
    expect(result.modifiedFields).toEqual([]);
  });

  it('detects added fields', () => {
    const oldSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
      },
    };
    const newSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
      },
    };
    const result = diffSchema(oldSchema, newSchema);
    expect(result.addedFields).toEqual(['email']);
    expect(result.removedFields).toEqual([]);
    expect(result.modifiedFields).toEqual([]);
  });

  it('detects removed fields', () => {
    const oldSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
      },
    };
    const newSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
      },
    };
    const result = diffSchema(oldSchema, newSchema);
    expect(result.addedFields).toEqual([]);
    expect(result.removedFields).toEqual(['email']);
    expect(result.modifiedFields).toEqual([]);
  });

  it('detects modified fields when type changes', () => {
    const oldSchema = {
      type: 'object',
      fields: {
        age: { type: 'string', required: true },
      },
    };
    const newSchema = {
      type: 'object',
      fields: {
        age: { type: 'number', required: true },
      },
    };
    const result = diffSchema(oldSchema, newSchema);
    expect(result.addedFields).toEqual([]);
    expect(result.removedFields).toEqual([]);
    expect(result.modifiedFields).toEqual(['age']);
  });

  it('detects modified fields when required status changes', () => {
    const oldSchema = {
      type: 'object',
      fields: {
        email: { type: 'string', required: true },
      },
    };
    const newSchema = {
      type: 'object',
      fields: {
        email: { type: 'string', required: false },
      },
    };
    const result = diffSchema(oldSchema, newSchema);
    expect(result.modifiedFields).toEqual(['email']);
  });

  it('handles all three change types simultaneously', () => {
    const oldSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        phone: { type: 'string', required: false },
      },
    };
    const newSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'number', required: true },
        address: { type: 'string', required: true },
      },
    };
    const result = diffSchema(oldSchema, newSchema);
    expect(result.addedFields).toEqual(['address']);
    expect(result.removedFields).toEqual(['phone']);
    expect(result.modifiedFields).toEqual(['email']);
  });

  it('handles null/undefined schemas gracefully', () => {
    expect(diffSchema(null, null)).toEqual({
      addedFields: [],
      removedFields: [],
      modifiedFields: [],
    });
    expect(diffSchema(undefined, { fields: { name: { type: 'string' } } })).toEqual({
      addedFields: ['name'],
      removedFields: [],
      modifiedFields: [],
    });
    expect(diffSchema({ fields: { name: { type: 'string' } } }, null)).toEqual({
      addedFields: [],
      removedFields: ['name'],
      modifiedFields: [],
    });
  });

  it('handles schemas with empty fields object', () => {
    const result = diffSchema({ fields: {} }, { fields: { name: { type: 'string' } } });
    expect(result.addedFields).toEqual(['name']);
  });
});

describe('diffSwagger', () => {
  const makeSwagger = (properties) => ({
    components: {
      schemas: {
        Person: {
          type: 'object',
          properties,
        },
      },
    },
  });

  it('returns empty diff when swagger documents are identical', () => {
    const swagger = makeSwagger({
      name: { type: 'string' },
      email: { type: 'string' },
    });
    const result = diffSwagger(swagger, swagger);
    expect(result.addedFields).toEqual([]);
    expect(result.removedFields).toEqual([]);
    expect(result.modifiedFields).toEqual([]);
  });

  it('detects added properties', () => {
    const oldSwagger = makeSwagger({
      name: { type: 'string' },
    });
    const newSwagger = makeSwagger({
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
    });
    const result = diffSwagger(oldSwagger, newSwagger);
    expect(result.addedFields).toEqual(['email', 'phone']);
    expect(result.removedFields).toEqual([]);
    expect(result.modifiedFields).toEqual([]);
  });

  it('detects removed properties', () => {
    const oldSwagger = makeSwagger({
      name: { type: 'string' },
      email: { type: 'string' },
    });
    const newSwagger = makeSwagger({
      name: { type: 'string' },
    });
    const result = diffSwagger(oldSwagger, newSwagger);
    expect(result.removedFields).toEqual(['email']);
  });

  it('detects modified properties when type changes', () => {
    const oldSwagger = makeSwagger({
      age: { type: 'string' },
    });
    const newSwagger = makeSwagger({
      age: { type: 'integer' },
    });
    const result = diffSwagger(oldSwagger, newSwagger);
    expect(result.modifiedFields).toEqual(['age']);
  });

  it('detects modified properties when required status changes', () => {
    const oldSwagger = makeSwagger({
      email: { type: 'string', required: false },
    });
    const newSwagger = makeSwagger({
      email: { type: 'string', required: true },
    });
    const result = diffSwagger(oldSwagger, newSwagger);
    expect(result.modifiedFields).toEqual(['email']);
  });

  it('handles null/undefined swagger documents gracefully', () => {
    expect(diffSwagger(null, null)).toEqual({
      addedFields: [],
      removedFields: [],
      modifiedFields: [],
    });
    const swagger = makeSwagger({ name: { type: 'string' } });
    expect(diffSwagger(null, swagger)).toEqual({
      addedFields: ['name'],
      removedFields: [],
      modifiedFields: [],
    });
    expect(diffSwagger(swagger, null)).toEqual({
      addedFields: [],
      removedFields: ['name'],
      modifiedFields: [],
    });
  });

  it('handles swagger with missing nested paths gracefully', () => {
    const partial = { components: {} };
    const full = makeSwagger({ name: { type: 'string' } });
    expect(diffSwagger(partial, full)).toEqual({
      addedFields: ['name'],
      removedFields: [],
      modifiedFields: [],
    });
  });
});
