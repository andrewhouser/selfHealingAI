'use strict';

/**
 * API Code Updater — LLM-powered
 *
 * Uses the MLX-LM server to intelligently update route handler code
 * based on schema changes, rather than using regex templates.
 */

const { callLLM, extractCode } = require('../shared/llm-client');

const SYSTEM_PROMPT = `You are a code assistant that modifies Express.js route handlers.
You will be given the current route file and a description of changes needed.
Output ONLY the complete updated file content — no explanations, no markdown fences, just the code.
Preserve the existing code style and structure. Make minimal, targeted changes.`;

/**
 * Uses the LLM to update endpoint code to include a new field in the response.
 *
 * @param {string} existingCode - Current content of routes/persons.js
 * @param {string} fieldName - The new field to add
 * @returns {Promise<string>} Updated code content
 */
async function addFieldToEndpoint(existingCode, fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    throw new Error('fieldName must be a non-empty string');
  }

  const userPrompt = `Here is the current routes/persons.js file:

\`\`\`javascript
${existingCode}
\`\`\`

A new field "${fieldName}" has been added to the database schema. The database already stores this field in all person records.

Since the route handlers use findAll() and findById() which return full documents from the database, the new field is already included in API responses automatically. No code change is needed for the response data.

However, please add a comment near the top of the file documenting that the "${fieldName}" field is now part of the Person record, so future developers know it exists.

Output the complete updated file.`;

  const response = await callLLM(SYSTEM_PROMPT, userPrompt);
  const code = extractCode(response, 'javascript');

  // Validate the response looks like valid route code
  if (!code.includes('router') || !code.includes('module.exports')) {
    // LLM produced something unexpected — fall back to simple comment insertion
    return `// Person record includes field: ${fieldName}\n${existingCode}`;
  }

  return code;
}

/**
 * Uses the LLM to update endpoint code to reflect a removed field.
 *
 * @param {string} existingCode - Current content of routes/persons.js
 * @param {string} fieldName - The field that was removed
 * @returns {Promise<string>} Updated code content
 */
async function removeFieldFromEndpoint(existingCode, fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    throw new Error('fieldName must be a non-empty string');
  }

  const userPrompt = `Here is the current routes/persons.js file:

\`\`\`javascript
${existingCode}
\`\`\`

The field "${fieldName}" has been REMOVED from the database schema. It no longer exists in the database.

Please update the code to:
1. Remove any comments referencing "${fieldName}"
2. If there's any explicit mapping or filtering that references "${fieldName}", remove those references
3. The route should continue to return whatever the database provides (findAll/findById return full documents)

Output the complete updated file.`;

  const response = await callLLM(SYSTEM_PROMPT, userPrompt);
  const code = extractCode(response, 'javascript');

  if (!code.includes('router') || !code.includes('module.exports')) {
    // LLM produced something unexpected — fall back to removing the comment
    return existingCode.replace(new RegExp(`.*${fieldName}.*\\n`, 'g'), '');
  }

  return code;
}

module.exports = { addFieldToEndpoint, removeFieldFromEndpoint };
