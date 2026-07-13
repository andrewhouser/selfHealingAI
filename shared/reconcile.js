'use strict';

/**
 * Generic goal-driven reconcile engine.
 *
 * This replaces the old prescriptive layer (per-project self-heal.js + the
 * hand-written *-updater.js prompts + test-generator.js). Instead of a human
 * pre-deciding "when field X is added, do Y", the model is handed:
 *
 *   - the node's one-line GOAL (the invariant to maintain),
 *   - the contract BEFORE and AFTER the change (in full), and
 *   - the current contents of the file it owns,
 *
 * and asked to output the reconciled file. The safety net is no longer a scripted
 * prompt — it is the node's own `verify` command. We apply the model's output,
 * run verify, and if it fails we feed the failure back and let the model try
 * again (up to maxReconcileAttempts). If it still can't converge, we revert every
 * owned file to its original content. This is what makes the loop agentic rather
 * than prescriptive: the model reasons toward a goal and proves it converged.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { callLLM, extractCode } = require('./llm-client');
const { sendNotification } = require('./notifier');
const { ROOT_DIR } = require('./registry');

const SYSTEM_PROMPT = `You are a code reconciliation agent. Your job is to keep a source file consistent with a data contract.
You are given a goal, the contract before and after a change, and the current contents of one source file.
Output ONLY the complete, updated contents of that file — no explanations, no markdown fences, just the file.
Change only what the goal requires. Preserve all unrelated code, imports, comments, and formatting.
If the file already satisfies the goal, output it unchanged.`;

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
Fix the file so verification passes. Output the complete updated file.`;
  } else {
    prompt += `

Output the complete updated contents of ${filePath}.`;
  }

  return prompt;
}

/**
 * Default verify runner — executes the node's verify command from the repo root.
 * Mirrors the old defaultRunTests in ui-project/self-heal.js.
 *
 * @param {string} command
 * @returns {{ success: boolean, output: string }}
 */
function defaultRunVerify(command) {
  try {
    const output = execSync(command, {
      cwd: ROOT_DIR,
      timeout: 60000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output };
  } catch (err) {
    const output = err.stdout || err.stderr || err.message || '';
    return { success: false, output };
  }
}

/**
 * Reconciles a node's owned files to a changed contract, verifying convergence.
 *
 * @param {Object} node - Hydrated registry node (needs project, goal, verify, ownsPaths, owns, maxReconcileAttempts)
 * @param {Object} oldContract - Contract before the change
 * @param {Object} newContract - Contract after the change
 * @param {Object} [deps] - Injectable dependencies (for testing)
 * @param {function} [deps.readFile] - (absPath) => string
 * @param {function} [deps.writeFile] - (absPath, content) => void
 * @param {function} [deps.callLLM] - (system, user) => Promise<string>
 * @param {function} [deps.runVerify] - (command) => { success, output }
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
        const currentContent = backups.get(absPath);

        const userPrompt = buildUserPrompt({
          goal: node.goal,
          oldContract,
          newContract,
          filePath: displayPath,
          currentContent,
          verifyError: attempt > 1 ? verifyError : '',
        });

        const response = await _callLLM(SYSTEM_PROMPT, userPrompt);
        const updated = extractCode(response, languageForFile(displayPath));
        _writeFile(absPath, updated);
      }
    } catch (err) {
      // Model call or write failed — revert and bail.
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
      result = _runVerify(node.verify);
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

module.exports = { reconcileNode, defaultRunVerify, buildUserPrompt, languageForFile, SYSTEM_PROMPT };
