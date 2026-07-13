'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { addColumnToPage, removeColumnFromPage } = require('./component-updater');
const { generateFieldTest } = require('./test-generator');
const { sendNotification } = require('../shared/notifier');

const PAGE_PATH = path.resolve(__dirname, 'app/page.tsx');
const TESTS_DIR = path.resolve(__dirname, '__tests__');

/**
 * Performs the self-healing update for the UI project:
 * 1. Reads the current app/page.tsx
 * 2. For each added field, applies addColumnToPage to add it to DEFAULT_FIELDS
 * 3. Writes updated page.tsx
 * 4. For each added field, generates a test file and writes it to __tests__/
 * 5. Executes the generated tests using vitest (within 30 seconds)
 * 6. On test pass: sends success notification
 * 7. On test fail: reverts page.tsx to original, deletes generated test files, sends failure notification
 *
 * @param {string[]} addedFields - Array of field names to add as columns
 * @param {Object} [deps] - Optional dependency overrides (for testing)
 * @param {function} [deps.readFile] - Custom file reader (path) => string
 * @param {function} [deps.writeFile] - Custom file writer (path, content) => void
 * @param {function} [deps.deleteFile] - Custom file deleter (path) => void
 * @param {function} [deps.addColumnToPage] - Custom component updater
 * @param {function} [deps.generateFieldTest] - Custom test generator
 * @param {function} [deps.runTests] - Custom test runner (testFilePaths) => { success: boolean, output: string }
 * @param {function} [deps.sendNotification] - Custom notification sender
 * @param {string} [deps.pagePath] - Custom path to app/page.tsx
 * @param {string} [deps.testsDir] - Custom path to __tests__/ directory
 * @returns {Promise<boolean>} true if update succeeded, false if it failed and was reverted
 */
async function performSelfHealingUpdate(addedFields, removedFields, deps = {}) {
  // Support old call signature: performSelfHealingUpdate(addedFields, deps)
  if (removedFields && !Array.isArray(removedFields)) {
    deps = removedFields;
    removedFields = [];
  }
  if (!removedFields) removedFields = [];

  const _readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf-8'));
  const _writeFile = deps.writeFile || ((p, content) => fs.writeFileSync(p, content, 'utf-8'));
  const _deleteFile = deps.deleteFile || ((p) => { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } });
  const _addColumnToPage = deps.addColumnToPage || addColumnToPage;
  const _removeColumnFromPage = deps.removeColumnFromPage || removeColumnFromPage;
  const _generateFieldTest = deps.generateFieldTest || generateFieldTest;
  const _runTests = deps.runTests || defaultRunTests;
  const _sendNotification = deps.sendNotification || sendNotification;
  const _pagePath = deps.pagePath || PAGE_PATH;
  const _testsDir = deps.testsDir || TESTS_DIR;

  // Step 1: Read original page.tsx (backup for revert)
  let originalCode;
  try {
    originalCode = _readFile(_pagePath);
  } catch (err) {
    await _sendNotification({
      title: 'UI_Project: Update Failed',
      message: `Failed to read app/page.tsx: ${err.message}`,
      project: 'UI_Project',
      changeType: 'component_modified',
      fieldName: addedFields.join(', '),
    });
    return false;
  }

  // Step 2: Apply component updates for each added/removed field (LLM-powered)
  let updatedCode = originalCode;
  try {
    for (const fieldName of addedFields) {
      updatedCode = await _addColumnToPage(updatedCode, fieldName);
    }
    for (const fieldName of removedFields) {
      updatedCode = await _removeColumnFromPage(updatedCode, fieldName);
    }
  } catch (err) {
    const allFields = [...addedFields, ...removedFields];
    await _sendNotification({
      title: 'UI_Project: Update Failed',
      message: `Component update failed for field(s) [${allFields.join(', ')}]: ${err.message}`,
      project: 'UI_Project',
      changeType: 'component_modified',
      fieldName: allFields.join(', '),
    });
    return false;
  }

  // Step 3: Write updated page.tsx
  try {
    _writeFile(_pagePath, updatedCode);
  } catch (err) {
    try {
      _writeFile(_pagePath, originalCode);
    } catch (revertErr) {
      console.error('Failed to revert app/page.tsx:', revertErr.message);
    }
    await _sendNotification({
      title: 'UI_Project: Update Failed',
      message: `Failed to write updated app/page.tsx: ${err.message}`,
      project: 'UI_Project',
      changeType: 'component_modified',
      fieldName: addedFields.join(', '),
    });
    return false;
  }

  // Step 4: Generate test files for each added field (skip for removals-only)
  const generatedTestPaths = [];
  if (addedFields.length > 0) {
    try {
      for (const fieldName of addedFields) {
        const testCode = _generateFieldTest(fieldName);
        const testFilePath = path.join(_testsDir, `PersonTable.${fieldName}.test.tsx`);
        _writeFile(testFilePath, testCode);
        generatedTestPaths.push(testFilePath);
      }
    } catch (err) {
      // Revert page.tsx and clean up any test files already written
      try {
        _writeFile(_pagePath, originalCode);
      } catch (revertErr) {
        console.error('Failed to revert app/page.tsx:', revertErr.message);
      }
      for (const testPath of generatedTestPaths) {
        _deleteFile(testPath);
      }
      await _sendNotification({
        title: 'UI_Project: Update Failed',
        message: `Test generation failed for field(s) [${addedFields.join(', ')}]: ${err.message}`,
        project: 'UI_Project',
        changeType: 'component_modified',
        fieldName: addedFields.join(', '),
      });
      return false;
    }
  }

  // Step 5: Execute generated tests (within 30 seconds) — skip if no tests to run
  if (generatedTestPaths.length > 0) {
    let testResult;
    try {
      testResult = _runTests(generatedTestPaths);
    } catch (err) {
      testResult = { success: false, output: err.message };
    }

    if (!testResult.success) {
      // Step 7: Revert on test failure
      try {
        _writeFile(_pagePath, originalCode);
      } catch (revertErr) {
        console.error('Failed to revert app/page.tsx:', revertErr.message);
      }
      for (const testPath of generatedTestPaths) {
        _deleteFile(testPath);
      }
      await _sendNotification({
        title: 'UI_Project: Test Failed',
        message: `Tests failed for field(s) [${addedFields.join(', ')}]: ${testResult.output}`,
        project: 'UI_Project',
        changeType: 'component_modified',
        fieldName: addedFields.join(', '),
      });
      return false;
    }
  }

  // Step 6: Send success notification
  const allFields = [...addedFields, ...removedFields];
  const summaryParts = [];
  if (addedFields.length > 0) summaryParts.push(`added: ${addedFields.join(', ')}`);
  if (removedFields.length > 0) summaryParts.push(`removed: ${removedFields.join(', ')}`);

  await _sendNotification({
    title: 'UI_Project: Update Complete',
    message: `Component updated — ${summaryParts.join('; ')}${addedFields.length > 0 ? '. All tests passed.' : '.'}`,
    project: 'UI_Project',
    changeType: 'component_modified',
    fieldName: allFields.join(', '),
  });

  return true;
}

/**
 * Default test runner that executes vitest on the given test files.
 * Runs with a 30-second timeout.
 *
 * @param {string[]} testFilePaths - Array of test file paths to run
 * @returns {{ success: boolean, output: string }}
 */
function defaultRunTests(testFilePaths) {
  const testFiles = testFilePaths.join(' ');
  try {
    const output = execSync(`npx vitest run ${testFiles}`, {
      cwd: path.resolve(__dirname),
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output };
  } catch (err) {
    // execSync throws on non-zero exit code
    const output = err.stdout || err.stderr || err.message;
    return { success: false, output: output };
  }
}

module.exports = { performSelfHealingUpdate, defaultRunTests, PAGE_PATH, TESTS_DIR };
