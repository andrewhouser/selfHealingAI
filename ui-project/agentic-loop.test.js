import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  start,
  readSwagger,
  mergeDiffs,
  hasChanges,
  formatChangeSummary,
  getPrimaryFieldName,
  SWAGGER_PATH,
  POLLING_INTERVAL,
} from './agentic-loop.js';

describe('ui-project/agentic-loop', () => {
  let tempDir;
  let swaggerPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-agentic-loop-test-'));
    swaggerPath = path.join(tempDir, 'swagger.json');

    // Write a base swagger file
    const baseSwagger = {
      openapi: '3.0.0',
      components: {
        schemas: {
          Person: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
    };
    fs.writeFileSync(swaggerPath, JSON.stringify(baseSwagger));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constants', () => {
    it('POLLING_INTERVAL is ≤ 2000ms', () => {
      expect(POLLING_INTERVAL).toBeLessThanOrEqual(2000);
    });

    it('SWAGGER_PATH points to api-project/swagger.json', () => {
      expect(SWAGGER_PATH).toContain('api-project');
      expect(SWAGGER_PATH).toContain('swagger.json');
    });
  });

  describe('readSwagger()', () => {
    it('reads and parses a valid swagger file', () => {
      const result = readSwagger(swaggerPath);
      expect(result.parseError).toBe(false);
      expect(result.data).toEqual({
        openapi: '3.0.0',
        components: {
          schemas: {
            Person: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
        },
      });
    });

    it('returns { data: null, parseError: false } for a non-existent file', () => {
      const result = readSwagger(path.join(tempDir, 'nonexistent.json'));
      expect(result.data).toBeNull();
      expect(result.parseError).toBe(false);
    });

    it('returns { data: null, parseError: true } for invalid JSON', () => {
      const invalidPath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(invalidPath, 'not valid json {{{');
      const result = readSwagger(invalidPath);
      expect(result.data).toBeNull();
      expect(result.parseError).toBe(true);
    });
  });

  describe('mergeDiffs()', () => {
    it('merges two diffs with no overlap', () => {
      const cumulative = { addedFields: ['a'], removedFields: [], modifiedFields: [] };
      const newDiff = { addedFields: ['b'], removedFields: ['c'], modifiedFields: [] };
      const result = mergeDiffs(cumulative, newDiff);
      expect(result.addedFields).toEqual(['a', 'b']);
      expect(result.removedFields).toEqual(['c']);
    });

    it('deduplicates fields across merges', () => {
      const cumulative = { addedFields: ['a', 'b'], removedFields: [], modifiedFields: [] };
      const newDiff = { addedFields: ['b', 'c'], removedFields: [], modifiedFields: [] };
      const result = mergeDiffs(cumulative, newDiff);
      expect(result.addedFields).toEqual(['a', 'b', 'c']);
    });

    it('accumulates across all categories', () => {
      const cumulative = { addedFields: ['a'], removedFields: ['x'], modifiedFields: ['m'] };
      const newDiff = { addedFields: ['b'], removedFields: ['y'], modifiedFields: ['n'] };
      const result = mergeDiffs(cumulative, newDiff);
      expect(result.addedFields).toEqual(['a', 'b']);
      expect(result.removedFields).toEqual(['x', 'y']);
      expect(result.modifiedFields).toEqual(['m', 'n']);
    });
  });

  describe('hasChanges()', () => {
    it('returns false for empty diff', () => {
      expect(hasChanges({ addedFields: [], removedFields: [], modifiedFields: [] })).toBe(false);
    });

    it('returns true when addedFields is non-empty', () => {
      expect(hasChanges({ addedFields: ['a'], removedFields: [], modifiedFields: [] })).toBe(true);
    });

    it('returns true when removedFields is non-empty', () => {
      expect(hasChanges({ addedFields: [], removedFields: ['a'], modifiedFields: [] })).toBe(true);
    });

    it('returns true when modifiedFields is non-empty', () => {
      expect(hasChanges({ addedFields: [], removedFields: [], modifiedFields: ['a'] })).toBe(true);
    });
  });

  describe('formatChangeSummary()', () => {
    it('formats added fields', () => {
      const result = formatChangeSummary({ addedFields: ['a', 'b'], removedFields: [], modifiedFields: [] });
      expect(result).toBe('Added: a, b');
    });

    it('formats removed fields', () => {
      const result = formatChangeSummary({ addedFields: [], removedFields: ['x'], modifiedFields: [] });
      expect(result).toBe('Removed: x');
    });

    it('formats combined changes', () => {
      const result = formatChangeSummary({ addedFields: ['a'], removedFields: ['b'], modifiedFields: ['c'] });
      expect(result).toBe('Added: a; Removed: b; Modified: c');
    });
  });

  describe('getPrimaryFieldName()', () => {
    it('joins all field names from all categories', () => {
      const result = getPrimaryFieldName({ addedFields: ['a', 'b'], removedFields: ['c'], modifiedFields: [] });
      expect(result).toBe('a, b, c');
    });
  });

  describe('start()', () => {
    it('returns an object with stop(), getCumulativeChanges(), isPromptPending(), clearPendingPrompt(), setPendingPrompt()', () => {
      const mockWatcher = { close: vi.fn(() => Promise.resolve()) };
      const mockCreateFileWatcher = vi.fn(() => mockWatcher);

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSwagger: vi.fn(),
        readSwaggerFn: vi.fn(() => ({ data: null, parseError: false })),
        swaggerPath,
      });

      expect(handle).toHaveProperty('stop');
      expect(handle).toHaveProperty('getCumulativeChanges');
      expect(handle).toHaveProperty('isPromptPending');
      expect(handle).toHaveProperty('clearPendingPrompt');
      expect(handle).toHaveProperty('setPendingPrompt');
    });

    it('calls createFileWatcher with the swagger path and interval ≤ 2000ms', () => {
      const mockWatcher = { close: vi.fn(() => Promise.resolve()) };
      const mockCreateFileWatcher = vi.fn(() => mockWatcher);

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSwagger: vi.fn(),
        readSwaggerFn: vi.fn(() => ({ data: null, parseError: false })),
        swaggerPath,
      });

      expect(mockCreateFileWatcher).toHaveBeenCalledTimes(1);
      const [filePath, options] = mockCreateFileWatcher.mock.calls[0];
      expect(filePath).toBe(swaggerPath);
      expect(options.interval).toBeLessThanOrEqual(2000);
      expect(typeof options.onChange).toBe('function');
      expect(typeof options.onError).toBe('function');
    });

    it('stop() calls watcher.close()', async () => {
      const mockClose = vi.fn(() => Promise.resolve());
      const mockCreateFileWatcher = vi.fn(() => ({ close: mockClose }));

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSwagger: vi.fn(),
        readSwaggerFn: vi.fn(() => ({ data: null, parseError: false })),
        swaggerPath,
      });

      await handle.stop();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('onChange behavior', () => {
    it('sends notification when swagger changes are detected', () => {
      const mockSendNotification = vi.fn();
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: ['date_of_birth'],
        removedFields: [],
        modifiedFields: [],
      }));

      const newSwagger = {
        components: {
          schemas: {
            Person: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
                date_of_birth: { type: 'string' },
              },
            },
          },
        },
      };
      const mockReadSwagger = vi.fn(() => ({ data: newSwagger, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'UI_Project',
          changeType: 'endpoint_updated',
          fieldName: 'date_of_birth',
        })
      );
    });

    it('sends parse error notification for invalid JSON', () => {
      const mockSendNotification = vi.fn();
      const mockReadSwagger = vi.fn(() => ({ data: null, parseError: true }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: vi.fn(),
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'UI_Project',
          message: expect.stringContaining('invalid JSON'),
        })
      );
    });

    it('sends inaccessible notification when swagger file cannot be read', () => {
      const mockSendNotification = vi.fn();
      const mockReadSwagger = vi.fn(() => ({ data: null, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: vi.fn(),
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'UI_Project',
          message: expect.stringContaining('no longer accessible'),
        })
      );
    });

    it('does not send notification when no changes are detected', () => {
      const mockSendNotification = vi.fn();
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: [],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('accumulates cumulative changes across multiple onChange events', () => {
      const mockSendNotification = vi.fn();
      let diffCallCount = 0;
      const mockDiffSwagger = vi.fn(() => {
        diffCallCount++;
        if (diffCallCount === 1) {
          return { addedFields: ['field_a'], removedFields: [], modifiedFields: [] };
        }
        return { addedFields: ['field_b'], removedFields: [], modifiedFields: [] };
      });
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      // First change
      onChangeHandler(swaggerPath);
      expect(handle.getCumulativeChanges().addedFields).toEqual(['field_a']);

      // Second change while prompt is pending
      onChangeHandler(swaggerPath);
      expect(handle.getCumulativeChanges().addedFields).toEqual(['field_a', 'field_b']);
    });

    it('sets promptPending to true when changes are detected', () => {
      const mockSendNotification = vi.fn();
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: ['new_field'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      expect(handle.isPromptPending()).toBe(false);
      onChangeHandler(swaggerPath);
      expect(handle.isPromptPending()).toBe(true);
    });

    it('clearPendingPrompt() resets cumulative changes and prompt state', () => {
      const mockSendNotification = vi.fn();
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: ['new_field'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);
      expect(handle.isPromptPending()).toBe(true);
      expect(handle.getCumulativeChanges().addedFields).toEqual(['new_field']);

      handle.clearPendingPrompt();
      expect(handle.isPromptPending()).toBe(false);
      expect(handle.getCumulativeChanges().addedFields).toEqual([]);
    });
  });

  describe('onError behavior', () => {
    it('sends notification when swagger file becomes inaccessible', () => {
      const mockSendNotification = vi.fn();

      let onErrorHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onErrorHandler = options.onError;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: vi.fn(),
        readSwaggerFn: vi.fn(() => ({ data: null, parseError: false })),
        swaggerPath,
      });

      onErrorHandler(new Error('ENOENT: file not found'));

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'UI_Project',
          message: expect.stringContaining('no longer accessible'),
        })
      );
    });
  });

  describe('approval prompt integration', () => {
    it('calls askApproval with cumulative changes summary after detecting changes', async () => {
      const mockSendNotification = vi.fn();
      const mockAskApproval = vi.fn(() => Promise.resolve(true));
      const mockPerformSelfHealingUpdate = vi.fn(() => Promise.resolve(true));
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: ['date_of_birth'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        askApproval: mockAskApproval,
        performSelfHealingUpdate: mockPerformSelfHealingUpdate,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      expect(mockAskApproval).toHaveBeenCalledTimes(1);
      expect(mockAskApproval.mock.calls[0][0]).toContain('Added: date_of_birth');
      expect(mockAskApproval.mock.calls[0][0]).toContain('Apply UI update?');
    });

    it('logs "Update approved" and calls self-healing update on approval', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockSendNotification = vi.fn();
      const mockAskApproval = vi.fn(() => Promise.resolve(true));
      const mockPerformSelfHealingUpdate = vi.fn(() => Promise.resolve(true));
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: ['new_field'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        askApproval: mockAskApproval,
        performSelfHealingUpdate: mockPerformSelfHealingUpdate,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      // Wait for the async approval to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith('Update approved — performing self-healing update...');
      expect(mockPerformSelfHealingUpdate).toHaveBeenCalledWith(['new_field']);
      expect(handle.isPromptPending()).toBe(false);
      expect(handle.getCumulativeChanges().addedFields).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('logs "Update rejected" and clears prompt on rejection', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockSendNotification = vi.fn();
      const mockAskApproval = vi.fn(() => Promise.resolve(false));
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: ['new_field'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        askApproval: mockAskApproval,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      // Wait for the async approval to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith('Update rejected');
      expect(handle.isPromptPending()).toBe(false);
      expect(handle.getCumulativeChanges().addedFields).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('skips asking for approval if prompt is already pending (requirement 6.6)', () => {
      const mockSendNotification = vi.fn();
      const mockAskApproval = vi.fn(() => new Promise(() => {})); // Never resolves (simulates waiting for user)
      let diffCallCount = 0;
      const mockDiffSwagger = vi.fn(() => {
        diffCallCount++;
        if (diffCallCount === 1) {
          return { addedFields: ['field_a'], removedFields: [], modifiedFields: [] };
        }
        return { addedFields: ['field_b'], removedFields: [], modifiedFields: [] };
      });
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        askApproval: mockAskApproval,
        swaggerPath,
      });

      // First change triggers prompt
      onChangeHandler(swaggerPath);
      expect(mockAskApproval).toHaveBeenCalledTimes(1);
      expect(handle.isPromptPending()).toBe(true);

      // Second change while prompt is pending — does NOT trigger new prompt
      onChangeHandler(swaggerPath);
      expect(mockAskApproval).toHaveBeenCalledTimes(1); // Still only called once
      // But changes ARE accumulated
      expect(handle.getCumulativeChanges().addedFields).toEqual(['field_a', 'field_b']);
    });

    it('does not call askApproval when no changes are detected', () => {
      const mockSendNotification = vi.fn();
      const mockAskApproval = vi.fn(() => Promise.resolve(true));
      const mockDiffSwagger = vi.fn(() => ({
        addedFields: [],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSwagger = vi.fn(() => ({ data: { components: {} }, parseError: false }));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSwagger: mockDiffSwagger,
        readSwaggerFn: mockReadSwagger,
        askApproval: mockAskApproval,
        swaggerPath,
      });

      onChangeHandler(swaggerPath);

      expect(mockAskApproval).not.toHaveBeenCalled();
    });
  });
});
