'use strict';

/**
 * LLM Client — Calls the MLX-LM server for code generation.
 * Uses OpenAI-compatible chat completions API.
 * Logs all interactions to logs/llm.log
 */

const fs = require('fs');
const path = require('path');

const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:8080/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'default';

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'llm.log');

/**
 * Appends a timestamped entry to the LLM log file.
 */
function writeLog(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const line = `\n${'='.repeat(80)}\n[${timestamp}] ${entry}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (err) {
    // Don't let logging failures break the flow
    console.error('[LLM Log] Failed to write log:', err.message);
  }
}

/**
 * Sends a prompt to the LLM and returns the generated text.
 *
 * @param {string} systemPrompt - System-level instructions
 * @param {string} userPrompt - The user message with context and task
 * @param {Object} [options] - Additional options
 * @param {number} [options.temperature=0.1] - Sampling temperature (low for deterministic code)
 * @param {number} [options.maxTokens=2048] - Max tokens to generate
 * @returns {Promise<string>} The generated text content
 */
async function callLLM(systemPrompt, userPrompt, options = {}) {
  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 2048;

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };

  console.log(`[LLM] Calling ${LLM_ENDPOINT}...`);
  console.log(`[LLM] Model: ${LLM_MODEL}`);
  console.log(`[LLM] Prompt length: ${userPrompt.length} chars`);

  writeLog(`REQUEST to ${LLM_ENDPOINT}\nModel: ${LLM_MODEL}\nTemperature: ${temperature}, Max Tokens: ${maxTokens}\n\n--- SYSTEM PROMPT ---\n${systemPrompt}\n\n--- USER PROMPT ---\n${userPrompt}`);

  const startTime = Date.now();

  const response = await fetch(LLM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000), // 60 second timeout
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] Request FAILED (${response.status}) after ${elapsed}s: ${errorText.slice(0, 200)}`);
    writeLog(`RESPONSE ERROR (${response.status}) after ${elapsed}s\n${errorText}`);
    throw new Error(`LLM request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    console.error(`[LLM] No choices returned after ${elapsed}s`);
    writeLog(`RESPONSE ERROR: No choices returned after ${elapsed}s\n${JSON.stringify(data, null, 2)}`);
    throw new Error('LLM returned no choices');
  }

  const rawContent = data.choices[0].message.content || '';
  
  // Extract thinking/reasoning trace if present
  // Qwen3 models wrap reasoning in <think>...</think> tags
  let thinking = '';
  let content = rawContent;
  
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = rawContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  // Also check if MLX-LM returns reasoning in a separate field
  const reasoningField = data.choices[0].message.reasoning_content 
    || data.choices[0].message.thinking 
    || '';
  if (reasoningField) {
    thinking = reasoningField;
  }

  // Clean up special tokens
  content = content.replace(/<\|im_end\|>/g, '').trim();

  console.log(`[LLM] Response received in ${elapsed}s (${content.length} chars${thinking ? `, thinking: ${thinking.length} chars` : ''})`);

  // Log everything including thinking trace
  let logEntry = `RESPONSE OK in ${elapsed}s (${content.length} chars)`;
  if (thinking) {
    logEntry += `\n\n--- THINKING/REASONING ---\n${thinking}`;
  }
  logEntry += `\n\n--- LLM OUTPUT ---\n${content}`;
  writeLog(logEntry);

  return content;
}

/**
 * Extracts code from an LLM response that may be wrapped in markdown code fences.
 *
 * @param {string} response - Raw LLM output
 * @param {string} [language] - Expected language (for fence matching)
 * @returns {string} Extracted code content
 */
function extractCode(response, language) {
  // Try to extract from ```language ... ``` or ``` ... ```
  const fencePatterns = [
    new RegExp(`\`\`\`${language || '\\w*'}\\s*\\n([\\s\\S]*?)\`\`\``, 'm'),
    /```\w*\s*\n([\s\S]*?)```/m,
  ];

  for (const pattern of fencePatterns) {
    const match = response.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // No code fences found — return the whole response trimmed
  return response.trim();
}

module.exports = { callLLM, extractCode, LLM_ENDPOINT, LLM_MODEL };
