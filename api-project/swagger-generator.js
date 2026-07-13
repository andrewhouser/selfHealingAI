const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.resolve(__dirname, '../database-project/schema.json');
const SWAGGER_OUTPUT_PATH = path.resolve(__dirname, 'swagger.json');

/**
 * Pure function that generates an OpenAPI 3.0 specification from a schema object.
 * Does not perform any file I/O — suitable for unit and property-based testing.
 *
 * @param {object} schema - The database schema object with a `fields` property
 * @returns {object} The generated OpenAPI 3.0 swagger document
 */
function generateSwaggerFromSchema(schema) {
  // Build Person properties from schema fields
  const personProperties = {};
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    personProperties[fieldName] = { type: fieldDef.type };
  }

  const swagger = {
    openapi: '3.0.0',
    info: { title: 'Person API', version: '1.0.0' },
    paths: {
      '/persons': {
        get: {
          summary: 'Retrieve all person records',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Person' }
                  }
                }
              }
            }
          }
        }
      },
      '/persons/{id}': {
        get: {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          summary: 'Retrieve a single person record',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Person' }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Person: {
          type: 'object',
          properties: personProperties
        }
      }
    }
  };

  return swagger;
}

/**
 * Reads the database schema and generates an OpenAPI 3.0 specification document.
 * Writes the result to api-project/swagger.json and returns the generated object.
 *
 * @returns {object} The generated OpenAPI 3.0 swagger document
 */
function generateSwagger() {
  const schemaContent = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const schema = JSON.parse(schemaContent);

  const swagger = generateSwaggerFromSchema(schema);

  fs.writeFileSync(SWAGGER_OUTPUT_PATH, JSON.stringify(swagger, null, 2), 'utf-8');

  return swagger;
}

// If run directly, generate the swagger.json file
if (require.main === module) {
  const swagger = generateSwagger();
  console.log('swagger.json generated successfully with fields:', Object.keys(swagger.components.schemas.Person.properties).join(', '));
}

module.exports = { generateSwagger, generateSwaggerFromSchema };
