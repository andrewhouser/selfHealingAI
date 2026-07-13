import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { performSelfHealingUpdate } = require('./self-heal.js');

describe('performSelfHealingUpdate', () => {
  const baseCode = `const express = require('express');\nres.json(persons);\nres.json(person);\nmodule.exports = router;`;

  function createDeps(overrides = {}) {
    return {
      readFile: overrides.readFile || (() => baseCode),
      writeFile: overrides.writeFile || vi.fn(),
      addFieldToEndpoint: overrides.addFieldToEndpoint || ((code, field) => code + `\n// added ${field}`),
      generateSwagger: overrides.generateSwagger || vi.fn(),
      sendNotification: overrides.sendNotification || vi.fn().mockResolvedValue(undefined),
      routesPath: '/fake/routes/persons.js',
      ...overrides,
    };
  }

  it('should return true on successful update', async () => {
    const deps = createDeps();
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);
    expect(result).toBe(true);
  });

  it('should read routes file, apply code updates, write back, and regenerate swagger', async () => {
    const writeFile = vi.fn();
    const generateSwagger = vi.fn();
    const addFieldToEndpoint = vi.fn((code, field) => code + `\n// ${field}`);

    const deps = createDeps({ writeFile, generateSwagger, addFieldToEndpoint });
    await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(addFieldToEndpoint).toHaveBeenCalledWith(baseCode, 'date_of_birth');
    expect(writeFile).toHaveBeenCalledWith('/fake/routes/persons.js', expect.stringContaining('date_of_birth'));
    expect(generateSwagger).toHaveBeenCalled();
  });

  it('should apply addFieldToEndpoint for each added field in sequence', async () => {
    const calls = [];
    const addFieldToEndpoint = vi.fn((code, field) => {
      calls.push(field);
      return code + `\n// ${field}`;
    });

    const deps = createDeps({ addFieldToEndpoint });
    await performSelfHealingUpdate(['field_a', 'field_b'], deps);

    expect(calls).toEqual(['field_a', 'field_b']);
  });

  it('should send success notification with endpoint_updated changeType', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ sendNotification });

    await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'API_Project',
        changeType: 'endpoint_updated',
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
        project: 'API_Project',
        changeType: 'endpoint_updated',
      })
    );
  });

  it('should return false and send failure notification if addFieldToEndpoint throws', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const addFieldToEndpoint = () => { throw new Error('invalid field'); };

    const deps = createDeps({ addFieldToEndpoint, sendNotification });
    const result = await performSelfHealingUpdate(['bad!field'], deps);

    expect(result).toBe(false);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Code generation failed'),
      })
    );
  });

  it('should revert routes file and return false if writeFile throws', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    let writeCallCount = 0;
    const writeFile = vi.fn(() => {
      writeCallCount++;
      if (writeCallCount === 1) throw new Error('disk full');
      // Second call (revert) succeeds
    });

    const deps = createDeps({ writeFile, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    // The second writeFile call is the revert attempt with original code
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenLastCalledWith('/fake/routes/persons.js', baseCode);
  });

  it('should revert routes file and return false if generateSwagger throws', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn();
    const generateSwagger = () => { throw new Error('schema parse error'); };

    const deps = createDeps({ writeFile, generateSwagger, sendNotification });
    const result = await performSelfHealingUpdate(['date_of_birth'], deps);

    expect(result).toBe(false);
    // writeFile should be called twice: once for the update, once for the revert
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenLastCalledWith('/fake/routes/persons.js', baseCode);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Swagger regeneration failed'),
      })
    );
  });

  it('should not crash if revert also fails', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const generateSwagger = () => { throw new Error('swagger error'); };
    const writeFile = vi.fn(() => { throw new Error('all writes fail'); });

    const deps = createDeps({ writeFile, generateSwagger, sendNotification });
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
});
