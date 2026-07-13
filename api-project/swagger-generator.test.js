import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SCHEMA_PATH = path.resolve(__dirname, '../database-project/schema.json');
const SWAGGER_OUTPUT_PATH = path.resolve(__dirname, 'swagger.json');

describe('swagger-generator', () => {
  let originalSchema;

  beforeEach(() => {
    originalSchema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    // Clear require cache before each test
    delete require.cache[require.resolve('./swagger-generator')];
  });

  afterEach(() => {
    // Restore original schema
    fs.writeFileSync(SCHEMA_PATH, originalSchema, 'utf-8');
  });

  it('generates valid OpenAPI 3.0 document with correct structure', () => {
    const { generateSwagger } = require('./swagger-generator');
    const swagger = generateSwagger();

    expect(swagger.openapi).toBe('3.0.0');
    expect(swagger.info.title).toBe('Person API');
    expect(swagger.info.version).toBe('1.0.0');
    expect(swagger.paths['/persons']).toBeDefined();
    expect(swagger.paths['/persons/{id}']).toBeDefined();
    expect(swagger.components.schemas.Person).toBeDefined();
  });

  it('includes all Person_Record fields from schema.json', () => {
    const { generateSwagger } = require('./swagger-generator');
    const swagger = generateSwagger();

    const personProps = swagger.components.schemas.Person.properties;
    expect(personProps.name).toEqual({ type: 'string' });
    expect(personProps.email).toEqual({ type: 'string' });
    expect(personProps.address).toEqual({ type: 'string' });
    expect(personProps.phone_number).toEqual({ type: 'string' });
  });

  it('writes swagger.json to disk', () => {
    const { generateSwagger } = require('./swagger-generator');
    generateSwagger();

    const fileContent = fs.readFileSync(SWAGGER_OUTPUT_PATH, 'utf-8');
    const parsed = JSON.parse(fileContent);
    expect(parsed.openapi).toBe('3.0.0');
    expect(parsed.components.schemas.Person.properties.name).toEqual({ type: 'string' });
  });

  it('picks up new fields added to schema.json', () => {
    const schema = JSON.parse(originalSchema);
    schema.fields.date_of_birth = { type: 'string', required: false };
    fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2), 'utf-8');

    const { generateSwagger } = require('./swagger-generator');
    const swagger = generateSwagger();

    const personProps = swagger.components.schemas.Person.properties;
    expect(personProps.date_of_birth).toEqual({ type: 'string' });
    expect(Object.keys(personProps)).toHaveLength(5);
  });

  it('defines correct endpoint parameters for /persons/{id}', () => {
    const { generateSwagger } = require('./swagger-generator');
    const swagger = generateSwagger();

    const getById = swagger.paths['/persons/{id}'].get;
    expect(getById.parameters).toHaveLength(1);
    expect(getById.parameters[0]).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' }
    });
  });
});
