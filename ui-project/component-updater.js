'use strict';

/**
 * UI Component Updater — LLM-powered
 *
 * Uses the MLX-LM server to intelligently update the page.tsx
 * DEFAULT_FIELDS array based on swagger changes.
 */

const { callLLM, extractCode } = require('../shared/llm-client');

const SYSTEM_PROMPT = `You are a code assistant that modifies Next.js/React TypeScript files.
You will be given the current page.tsx file and a description of changes needed.
Output ONLY the complete updated file content — no explanations, no markdown fences, just the code.
Preserve the existing code style, imports, and structure. Make minimal, targeted changes.`;

/**
 * Uses the LLM to add a new field to the DEFAULT_FIELDS array in page.tsx.
 *
 * @param {string} pageCode - Current content of app/page.tsx
 * @param {string} fieldName - New field to add as a column
 * @returns {Promise<string>} Updated page code
 */
async function addColumnToPage(pageCode, fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    throw new Error('fieldName must be a non-empty string');
  }

  const userPrompt = `Here is the current app/page.tsx file:

\`\`\`tsx
${pageCode}
\`\`\`

A new field "${fieldName}" has been added to the Person API. Add '${fieldName}' to the DEFAULT_FIELDS array so it appears as a new column in the table.

Output the complete updated file.`;

  const response = await callLLM(SYSTEM_PROMPT, userPrompt);
  const code = extractCode(response, 'tsx');

  // Validate the response contains key elements
  if (!code.includes('DEFAULT_FIELDS') || !code.includes('PersonTable')) {
    // LLM produced something unexpected — fall back to regex approach
    return fallbackAddColumn(pageCode, fieldName);
  }

  // Verify the field was actually added
  if (!code.includes(fieldName)) {
    return fallbackAddColumn(pageCode, fieldName);
  }

  return code;
}

/**
 * Uses the LLM to remove a field from the DEFAULT_FIELDS array in page.tsx.
 *
 * @param {string} pageCode - Current content of app/page.tsx
 * @param {string} fieldName - Field to remove from columns
 * @returns {Promise<string>} Updated page code
 */
async function removeColumnFromPage(pageCode, fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    throw new Error('fieldName must be a non-empty string');
  }

  const userPrompt = `Here is the current app/page.tsx file:

\`\`\`tsx
${pageCode}
\`\`\`

The field "${fieldName}" has been REMOVED from the Person API. Remove '${fieldName}' from the DEFAULT_FIELDS array so that column no longer appears in the table.

Output the complete updated file.`;

  const response = await callLLM(SYSTEM_PROMPT, userPrompt);
  const code = extractCode(response, 'tsx');

  // Validate the response contains key elements
  if (!code.includes('DEFAULT_FIELDS') || !code.includes('PersonTable')) {
    return fallbackRemoveColumn(pageCode, fieldName);
  }

  // Verify the field was actually removed
  if (code.includes(`'${fieldName}'`) || code.includes(`"${fieldName}"`)) {
    return fallbackRemoveColumn(pageCode, fieldName);
  }

  return code;
}

// --- Fallback implementations (regex-based, used if LLM fails) ---

function fallbackAddColumn(pageCode, fieldName) {
  const defaultFieldsRegex = /const DEFAULT_FIELDS = \[([^\]]*)\]/;
  const match = pageCode.match(defaultFieldsRegex);
  if (!match) throw new Error('Could not find DEFAULT_FIELDS array in page code');

  const existingFields = match[1].trim();
  const updatedFields = existingFields ? `${existingFields}, '${fieldName}'` : `'${fieldName}'`;
  return pageCode.replace(defaultFieldsRegex, `const DEFAULT_FIELDS = [${updatedFields}]`);
}

function fallbackRemoveColumn(pageCode, fieldName) {
  const defaultFieldsRegex = /const DEFAULT_FIELDS = \[([^\]]*)\]/;
  const match = pageCode.match(defaultFieldsRegex);
  if (!match) throw new Error('Could not find DEFAULT_FIELDS array in page code');

  const fieldEntries = match[1].trim()
    .split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0)
    .filter(f => f.replace(/^['"]|['"]$/g, '') !== fieldName);

  return pageCode.replace(defaultFieldsRegex, `const DEFAULT_FIELDS = [${fieldEntries.join(', ')}]`);
}

module.exports = { addColumnToPage, removeColumnFromPage };
