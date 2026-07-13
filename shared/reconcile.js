'use strict';

/**
 * Generic goal-driven reconcile engine.
 *
 * Uses patch-style edits: the LLM outputs search/replace blocks rather than
 * regenerating entire files. This is more reliable with small local models,
 * preserves untouched code exactly, and produces cleaner diffs for review.
 *
 * The safety net is the node's `verify` command. We apply patches, run verify,
 * and if it fails we feed the error back and let the model try again (up to
 * maxReconcileAttempts). If it still can't converge, we revert.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { callLLM, extractCode } = require('./llm-client');
const { sendNotification } = require('./notifier');
const { ROOT_DIR } = require('./registry');

const SYSTEM_PROMPT = `You are a code reconciliation agent. Your job is to keep a source file consistent with a data contract.
You are given a goal, the contract before and after a change, and the current contents of one source file.

Output ONLY search/replace edit blocks. Each block identifies the exact lines to find and what to replace them with.

Format each edit block exactly like this:

<<<<<<< SEARCH
exact lines to find in the file
=======
replacement lines
>>>>>>> REPLACE

Rules:
- The SEARCH section must match the file content EXACTLY (including whitespace and indentation).
- Include enough context lines in SEARCH to uniquely identify the location (typically 2-3 surrounding lines).
- You may output multiple edit blocks if multiple changes are needed.
- If the file already satisfies the goal, output only: NO_CHANGES_NEEDED
- Do NOT output the entire file. Only output the minimal edit blocks needed.
- Do NOT include explanations, markdown fences, or anything outside the edit blocks.`;

/**
 * Infers a fenced-code language hint from a file extension, for extractCode().
 * @param {string} filePath
 * @returns {string}
 */
function languageForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.jsx':
      return 'javascript';
    case '.json':
      return 'json';
    default:
      return '';
  }
}

/**
 * Parses search/replace blocks from LLM output.
 *
 * @param {string} response - Raw LLM output
 * @returns {Array<{ search: string, replace: string }>} Parsed edit blocks
 */
function parseEditBlocks(response) {
  const blocks = [];
  const pattern = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
  }

  return blocks;
}

/**
 * Applies search/replace edit blocks to file content.
 * Each block's search string must appear exactly once in the content.
 *
 * @param {string} content - Original file content
 * @param {Array<{ search: string, replace: string }>} blocks - Edit blocks to apply
 * @returns {{ result: string, applied: number, failed: string[] }}
 */
function applyEditBlocks(content, blocks) {
  let result = content;
  let applied = 0;
  const failed = [];

  for (const block of blocks) {
    const idx = result.indexOf(block.search);
    if (idx === -1) {
      failed.push(block.search.slice(0, 80));
      continue;
    }

    // Verify uniqueness — the search string should only appear once
    const secondIdx = result.indexOf(block.search, idx + 1);
    if (secondIdx !== -1) {
      failed.push(`(ambiguous) ${block.search.slice(0, 80)}`);
      continue;
    }

    result = result.slice(0, idx) + block.replace + result.slice(idx + block.search.length);
    applied++;
  }

  return { result, applied, failed };
}

/**
 * Builds the user prompt for reconciling a single owned file.
 *
 * @param {Object} params
 * @param {string} params.goal
 * @param {Object} params.oldContract
 * @param {Object} params.newContract
 * @param {string} params.filePath - Repo-relative display path
 * @param {string} params.currentContent
 * @param {string} [params.verifyError] - Verifier output from the previous failed attempt
 * @returns {string}
 */
function buildUserPrompt({ goal, oldContract, newContract, filePath, currentContent, verifyError }) {
  const lang = languageForFile(filePath) || 'text';
  let prompt = `GOAL:
${goal}

CONTRACT — BEFORE:
\`\`\`json
${JSON.stringify(oldContract, null, 2)}
\`\`\`

CONTRACT — AFTER:
\`\`\`json
${JSON.stringify(newContract, null, 2)}
\`\`\`

CURRENT CONTENTS OF ${filePath}:
\`\`\`${lang}
${currentContent}
\`\`\``;

  if (verifyError) {
    prompt += `

Your previous attempt did not pass verification. The verify command reported:
\`\`\`
${verifyError.slice(0, 2000)}
\`\`\`
Fix the file so verification passes. Output search/replace edit blocks for the fix.`;
  } else {
    prompt += `

Output search/replace edit blocks to update ${filePath}, or NO_CHANGES_NEEDED if it already satisfies the goal.`;
  }

  return prompt;
}

/**
 * Async verify runner — executes the node's verify command from the repo root.
 * Non-blocking: does not hold the event loop during test execution.
 *
 * @param {string} command
 * @returns {Promise<{ success: boolean, output: string }>}
 */
function defaultRunVerify(command) {
  return new Promise((resolve) => {
    exec(command, {
      cwd: ROOT_DIR,
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        const output = stdout || stderr || err.message || '';
        resolve({ success: false, output });
      } else {
        resolve({ success: true, output: stdout || '' });
      }
    });
  });
}

/**
 * Reconciles a node's owned files to a changed contract, verifying convergence.
 *
 * @param {Object} node - Hydrated registry node
 * @param {Object} oldContract - Contract before the change
 * @param {Object} newContract - Contract after the change
 * @param {Object} [deps] - Injectable dependencies
 * @param {function} [deps.readFile] - (absPath) => string
 * @param {function} [deps.writeFile] - (absPath, content) => void
 * @param {function} [deps.callLLM] - (system, user) => Promise<string>
 * @param {function} [deps.runVerify] - (command) => Promise<{ success, output }>
 * @param {function} [deps.sendNotification] - notification sender
 * @returns {Promise<boolean>} true if verification passed, false if reverted
 */
async function reconcileNode(node, oldContract, newContract, deps = {}) {
  const _readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf-8'));
  const _writeFile = deps.writeFile || ((p, content) => fs.writeFileSync(p, content, 'utf-8'));
  const _callLLM = deps.callLLM || callLLM;
  const _runVerify = deps.runVerify || defaultRunVerify;
  const _sendNotification = deps.sendNotification || sendNotification;

  const ownsPaths = node.ownsPaths || node.owns || [];
  const displayPaths = node.owns || ownsPaths;
  const maxAttempts = node.maxReconcileAttempts || 2;

  // Step 1: back up every owned file so we can revert if we can't converge.
  const backups = new Map();
  try {
    for (const absPath of ownsPaths) {
      backups.set(absPath, _readFile(absPath));
    }
  } catch (err) {
    await _sendNotification({
      title: `${node.project}: Reconcile Failed`,
      message: `Could not read an owned file: ${err.message}`,
      project: node.project,
      changeType: 'contract_reconciled',
      fieldName: (node.owns || []).join(', '),
    });
    return false;
  }

  // Step 2: reconcile → verify → (retry with feedback) loop.
  let verifyError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      for (let i = 0; i < ownsPaths.length; i++) {
        const absPath = ownsPaths[i];
        const displayPath = displayPaths[i] || absPath;
        const currentContent = attempt === 1 ? backups.get(absPath) : _readFile(absPath);

        const userPrompt = buildUserPrompt({
          goal: node.goal,
          oldContract,
          newContract,
          filePath: displayPath,
          currentContent,
          verifyError: attempt > 1 ? verifyError : '',
        });

        const response = await _callLLM(SYSTEM_PROMPT, userPrompt);

        // Check for no-change signal
        if (response.trim() === 'NO_CHANGES_NEEDED') {
          continue;
        }

        // Parse and apply edit blocks
        const blocks = parseEditBlocks(response);

        if (blocks.length === 0) {
          // Fallback: model may have returned full file content despite instructions
          const fallback = extractCode(response, languageForFile(displayPath));
          if (fallback) {
            _writeFile(absPath, fallback);
          }
          continue;
        }

        const { result, applied, failed } = applyEditBlocks(currentContent, blocks);
        if (failed.length > 0) {
          console.warn(`[${node.project}] ${failed.length} edit block(s) could not be applied on attempt ${attempt}`);
        }
        if (applied > 0) {
          _writeFile(absPath, result);
        }
      }
    } catch (err) {
      revertAll(backups, _writeFile);
      console.error(`[${node.project}] Reconcile attempt ${attempt} errored: ${err.message}`);
      await _sendNotification({
        title: `${node.project}: Reconcile Failed`,
        message: `Reconcile attempt ${attempt} errored: ${err.message}`,
        project: node.project,
        changeType: 'contract_reconciled',
        fieldName: (node.owns || []).join(', '),
      });
      return false;
    }

    // Verify convergence.
    let result;
    try {
      result = await _runVerify(node.verify);
    } catch (err) {
      result = { success: false, output: err.message };
    }

    if (result.success) {
      await _sendNotification({
        title: `${node.project}: Reconciled`,
        message: `Owned files reconciled to the new contract and verified (attempt ${attempt}).`,
        project: node.project,
        changeType: 'contract_reconciled',
        fieldName: (node.owns || []).join(', '),
      });
      return true;
    }

    verifyError = result.output || '';
    console.error(`[${node.project}] Verify failed on attempt ${attempt}:\n${verifyError.slice(0, 800)}`);
  }

  // Step 3: exhausted attempts — revert to the original content.
  revertAll(backups, _writeFile);
  console.error(`[${node.project}] Could not converge after ${maxAttempts} attempts; owned files reverted.`);
  await _sendNotification({
    title: `${node.project}: Reconcile Failed`,
    message: `Could not converge after ${maxAttempts} attempts; reverted. Last verify output: ${verifyError.slice(0, 300)}`,
    project: node.project,
    changeType: 'contract_reconciled',
    fieldName: (node.owns || []).join(', '),
  });
  return false;
}

/**
 * Restores every owned file to its backed-up content, ignoring individual failures.
 * @param {Map<string,string>} backups
 * @param {function} writeFile
 */
function revertAll(backups, writeFile) {
  for (const [absPath, content] of backups.entries()) {
    try {
      writeFile(absPath, content);
    } catch (err) {
      console.error(`Failed to revert ${absPath}:`, err.message);
    }
  }
}

/**
 * Proposes reconciled file contents without writing to disk.
 * Calls the LLM once per owned file and returns the proposed new content
 * alongside the original, so callers can diff/review before applying.
 *
 * @param {Object} node - Hydrated registry node
 * @param {Object} oldContract - Contract before the change
 * @param {Object} newContract - Contract after the change
 * @param {Object} [deps] - Injectable dependencies
 * @param {function} [deps.readFile] - (absPath) => string
 * @param {function} [deps.callLLM] - (system, user) => Promise<string>
 * @returns {Promise<Array<{ absPath: string, displayPath: string, original: string, proposed: string }>>}
 */
async function proposeChanges(node, oldContract, newContract, deps = {}) {
  const _readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf-8'));
  const _callLLM = deps.callLLM || callLLM;

  const ownsPaths = node.ownsPaths || node.owns || [];
  const displayPaths = node.owns || ownsPaths;
  const proposals = [];

  for (let i = 0; i < ownsPaths.length; i++) {
    const absPath = ownsPaths[i];
    const displayPath = displayPaths[i] || absPath;
    const original = _readFile(absPath);

    const userPrompt = buildUserPrompt({
      goal: node.goal,
      oldContract,
      newContract,
      filePath: displayPath,
      currentContent: original,
    });

    const response = await _callLLM(SYSTEM_PROMPT, userPrompt);

    // Check for no-change signal
    if (response.trim() === 'NO_CHANGES_NEEDED') {
      proposals.push({ absPath, displayPath, original, proposed: original });
      continue;
    }

    // Parse and apply edit blocks
    const blocks = parseEditBlocks(response);

    if (blocks.length === 0) {
      // Fallback: model may have returned full file content
      const fallback = extractCode(response, languageForFile(displayPath));
      proposals.push({ absPath, displayPath, original, proposed: fallback || original });
      continue;
    }

    const { result, applied, failed } = applyEditBlocks(original, blocks);
    if (failed.length > 0) {
      console.warn(`[${node.project}] ${failed.length} edit block(s) failed to apply during proposal`);
    }
    proposals.push({ absPath, displayPath, original, proposed: applied > 0 ? result : original });
  }

  return proposals;
}

/**
 * Applies a set of proposals to disk.
 *
 * @param {Array<{ absPath: string, proposed: string }>} proposals
 * @param {Object} [deps]
 * @param {function} [deps.writeFile] - (absPath, content) => void
 */
function applyProposals(proposals, deps = {}) {
  const _writeFile = deps.writeFile || ((p, content) => fs.writeFileSync(p, content, 'utf-8'));
  for (const { absPath, proposed } of proposals) {
    _writeFile(absPath, proposed);
  }
}

module.exports = {
  reconcileNode,
  proposeChanges,
  applyProposals,
  defaultRunVerify,
  buildUserPrompt,
  languageForFile,
  parseEditBlocks,
  applyEditBlocks,
  SYSTEM_PROMPT,
};
