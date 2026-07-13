import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { performSelfHealingUpdate } = require('./self-heal.js');

describe('performSelfHealingUpdate', () => {
  const basePageCode = `'use client';\nconst DEFAULT_FIELDS = ['name', 'email', 'address', 'phone_number'];\nexport default function Home() { return <div />; }`;

  function createDeps(overrides = {}) {
    return {
      readFile: overrides.readFile || (() => basePageCode),
      writeFile: overrides.writeFile || vi.fn(),
      deleteFile: overrides.deleteFile || vi.fn(),
      addColumnToPage: overrides.addColumnToPage || ((code, field) => code.replace(
        /const DEFAULT_FIELDS = \[([^\]]*)\]/,
        (match, fields) => `const DEFAULT_FIELDS = [${fields}, '${field}']`
      )),
      generateFieldTest: overrides.generateFieldTest || ((field) => `// test for ${field}`),
      runTests: overrides.runTests || (() => ({ success: true, output: 'All tests passed' })),
      sendNotification: overrides.sendNotification || vi.fn().mockResolvedValue(undefined),
      pagePath: '/fake/app/page.tsx',
      testsDir: '/fake/__tests__',
      ...overrides,
    };
  }

  it('should return true on successful update', async () => {
    const deps = createDeps();
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);
    expect(result).toBe(true);
  });

  it('should read page.tsx, apply updates, write back, generate tests, run tests', async () => {
    const writeFile = vi.fn();
    const addColumnToPage = vi.fn((code, field) => code + `\n// ${field}`);
    const generateFieldTest = vi.fn((field) => `// test for ${field}`);
    const runTests = vi.fn(() => ({ success: true, output: 'passed' }));

    const deps = createDeps({ writeFile, addColumnToPage, generateFieldTest, runTests });
    await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(addColumnToPage).toHaveBeenCalledWith(basePageCode, 'date_of_birth');
    expect(writeFile).toHaveBeenCalledWith('/fake/app/page.tsx', expect.stringContaining('date_of_birth'));
    expect(generateFieldTest).toHaveBeenCalledWith('date_of_birth');
    expect(writeFile).toHaveBeenCalledWith('/fake/__tests__/PersonTable.date_of_birth.test.tsx', '// test for date_of_birth');
    expect(runTests).toHaveBeenCalledWith(['/fake/__tests__/PersonTable.date_of_birth.test.tsx']);
  });

  it('should apply addColumnToPage for each added field in sequence', async () => {
    const calls = [];
    const addColumnToPage = vi.fn((code, field) => {
      calls.push(field);
      return code + `\n// ${field}`;
    });

    const deps = createDeps({ addColumnToPage });
    await performSelfHealingUpdate(['field_a', 'field_b'], deps);

    expect(calls).toEqual(['field_a', 'field_b']);
  });

  it('should send success notification with component_modified changeType on test pass', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ sendNotification });

    await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'UI_Project',
        changeType: 'component_modified',
        fieldName: 'date_of_birth',
      })
    );
  });

  it('should return false and send failure notification if readFile throws', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const readFile = () => { throw new Error('ENOENT'); };

    const deps = createDeps({ readFile, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'UI_Project',
        changeType: 'component_modified',
        message: expect.stringContaining('Failed to read app/page.tsx'),
      })
    );
  });

  it('should return false and send failure notification if addColumnToPage throws', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const addColumnToPage = () => { throw new Error('invalid field'); };

    const deps = createDeps({ addColumnToPage, sendNotification });
    const result = await performSelfHealingUpdate(['bad_field'], deps);

    expect(result).toBe(false);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Component update failed'),
      })
    );
  });

  it('should revert page.tsx and return false if writeFile throws on page write', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    let writeCallCount = 0;
    const writeFile = vi.fn(() => {
      writeCallCount++;
      if (writeCallCount === 1) throw new Error('disk full');
      // Subsequent calls (revert) succeed
    });

    const deps = createDeps({ writeFile, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    // Second writeFile call is the revert attempt with original code
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenLastCalledWith('/fake/app/page.tsx', basePageCode);
  });

  it('should revert page.tsx and delete test files on test failure', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn();
    const deleteFile = vi.fn();
    const runTests = () => ({ success: false, output: 'Test assertion failed' });

    const deps = createDeps({ writeFile, deleteFile, runTests, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    // writeFile called: 1) write updated page, 2) write test file, 3) revert page
    expect(writeFile).toHaveBeenLastCalledWith('/fake/app/page.tsx', basePageCode);
    expect(deleteFile).toHaveBeenCalledWith('/fake/__tests__/PersonTable.date_of_birth.test.tsx');
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'UI_Project: Test Failed',
        message: expect.stringContaining('Tests failed'),
      })
    );
  });

  it('should revert and clean up if test generation throws', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn();
    const deleteFile = vi.fn();
    const generateFieldTest = () => { throw new Error('template error'); };

    const deps = createDeps({ writeFile, deleteFile, generateFieldTest, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    // Should revert page.tsx
    expect(writeFile).toHaveBeenLastCalledWith('/fake/app/page.tsx', basePageCode);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Test generation failed'),
      })
    );
  });

  it('should not crash if revert also fails', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const runTests = () => ({ success: false, output: 'test error' });
    const writeFile = vi.fn(() => { throw new Error('all writes fail'); });

    const deps = createDeps({ writeFile, runTests, sendNotification });
    // Should not throw, should gracefully return false
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
  });

  it('should include all field names in success notification when multiple fields', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ sendNotification });

    await performSelfHealingUpdate(['field_a', 'field_b'], deps);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'field_a, field_b',
        message: expect.stringContaining('field_a, field_b'),
      })
    );
  });

  it('should handle runTests throwing an exception gracefully', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const deleteFile = vi.fn();
    const writeFile = vi.fn();
    const runTests = () => { throw new Error('vitest binary not found'); };

    const deps = createDeps({ writeFile, deleteFile, runTests, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    // Should revert page.tsx and delete test files
    expect(writeFile).toHaveBeenLastCalledWith('/fake/app/page.tsx', basePageCode);
    expect(deleteFile).toHaveBeenCalledWith('/fake/__tests__/PersonTable.date_of_birth.test.tsx');
  });

  it('should generate tests for multiple fields and pass all paths to runTests', async () => {
    const runTests = vi.fn(() => ({ success: true, output: 'all passed' }));
    const deps = createDeps({ runTests });

    await performSelfHealingUpdate(['field_a', 'field_b'], deps);

    expect(runTests).toHaveBeenCalledWith([
      '/fake/__tests__/PersonTable.field_a.test.tsx',
      '/fake/__tests__/PersonTable.field_b.test.tsx',
    ]);
  });
});
