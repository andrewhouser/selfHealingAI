import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { start, readSchema, SCHEMA_PATH, POLLING_INTERVAL } from './agentic-loop.js';

describe('api-project/agentic-loop', () => {
  let tempDir;
  let schemaPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-loop-test-'));
    schemaPath = path.join(tempDir, 'schema.json');

    // Write a base schema file
    const baseSchema = {
      type: 'object',
      fields: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
      },
    };
    fs.writeFileSync(schemaPath, JSON.stringify(baseSchema));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constants', () => {
    it('POLLING_INTERVAL is ≤ 2000ms', () => {
      expect(POLLING_INTERVAL).toBeLessThanOrEqual(2000);
    });

    it('SCHEMA_PATH points to database-project/schema.json', () => {
      expect(SCHEMA_PATH).toContain('database-project');
      expect(SCHEMA_PATH).toContain('schema.json');
    });
  });

  describe('readSchema()', () => {
    it('reads and parses a valid schema file', () => {
      const result = readSchema(schemaPath);
      expect(result).toEqual({
        type: 'object',
        fields: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
        },
      });
    });

    it('returns null for a non-existent file', () => {
      const result = readSchema(path.join(tempDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const invalidPath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(invalidPath, 'not valid json {{{');
      const result = readSchema(invalidPath);
      expect(result).toBeNull();
    });
  });

  describe('start()', () => {
    it('returns an object with a stop() method', () => {
      const mockWatcher = { close: vi.fn(() => Promise.resolve()) };
      const mockCreateFileWatcher = vi.fn(() => mockWatcher);

      const handle = start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSchema: vi.fn(),
        readSchemaFn: vi.fn(() => null),
        schemaPath,
      });

      expect(handle).toHaveProperty('stop');
      expect(typeof handle.stop).toBe('function');
    });

    it('calls createFileWatcher with the schema path and interval ≤ 2000ms', () => {
      const mockWatcher = { close: vi.fn(() => Promise.resolve()) };
      const mockCreateFileWatcher = vi.fn(() => mockWatcher);

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSchema: vi.fn(),
        readSchemaFn: vi.fn(() => null),
        schemaPath,
      });

      expect(mockCreateFileWatcher).toHaveBeenCalledTimes(1);
      const [filePath, options] = mockCreateFileWatcher.mock.calls[0];
      expect(filePath).toBe(schemaPath);
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
        diffSchema: vi.fn(),
        readSchemaFn: vi.fn(() => null),
        schemaPath,
      });

      await handle.stop();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('onChange behavior', () => {
    it('sends notification when new fields are detected', async () => {
      const mockSendNotification = vi.fn();
      const mockDiffSchema = vi.fn(() => ({
        addedFields: ['date_of_birth'],
        removedFields: [],
        modifiedFields: [],
      }));

      const newSchema = {
        type: 'object',
        fields: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
          date_of_birth: { type: 'string', required: false },
        },
      };
      const mockReadSchema = vi.fn(() => newSchema);
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      // Trigger the onChange handler
      await onChangeHandler(schemaPath);

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'API_Project',
          changeType: 'field_added',
          fieldName: 'date_of_birth',
        })
      );
    });

    it('sends notification with multiple field names joined by comma', async () => {
      const mockSendNotification = vi.fn();
      const mockDiffSchema = vi.fn(() => ({
        addedFields: ['date_of_birth', 'middle_name'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSchema = vi.fn(() => ({ type: 'object', fields: {} }));
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldName: 'date_of_birth, middle_name',
        })
      );
    });

    it('does not send notification when no new fields are detected', async () => {
      const mockSendNotification = vi.fn();
      const mockDiffSchema = vi.fn(() => ({
        addedFields: [],
        removedFields: ['old_field'],
        modifiedFields: [],
      }));
      const mockReadSchema = vi.fn(() => ({ type: 'object', fields: {} }));
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('sends notification when schema becomes unreadable after change', async () => {
      const mockSendNotification = vi.fn();
      const mockReadSchema = vi.fn(() => null); // file unreadable
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: vi.fn(),
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'API_Project',
          message: expect.stringContaining('could not be read'),
        })
      );
    });

    it('updates cached schema after detecting changes', async () => {
      const mockSendNotification = vi.fn();
      const mockDiffSchema = vi.fn(() => ({
        addedFields: ['new_field'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      const initialSchema = { type: 'object', fields: { a: { type: 'string' } } };
      const schema1 = { type: 'object', fields: { a: { type: 'string' }, b: { type: 'string' } } };
      const schema2 = { type: 'object', fields: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } } };

      // readSchemaFn is called: once at start (init cache), then once per onChange
      let readCount = 0;
      const mockReadSchema = vi.fn(() => {
        readCount++;
        if (readCount === 1) return initialSchema; // init cache
        if (readCount === 2) return schema1;       // first onChange
        return schema2;                            // second onChange
      });

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      // First change - diff should compare initialSchema vs schema1
      await onChangeHandler(schemaPath);
      expect(mockDiffSchema.mock.calls[0][0]).toEqual(initialSchema);
      expect(mockDiffSchema.mock.calls[0][1]).toEqual(schema1);

      // Second change - diff should compare schema1 (now cached) vs schema2
      await onChangeHandler(schemaPath);
      expect(mockDiffSchema.mock.calls[1][0]).toEqual(schema1);
      expect(mockDiffSchema.mock.calls[1][1]).toEqual(schema2);
    });

    it('calls askApproval after notification when fields are added', async () => {
      const mockSendNotification = vi.fn();
      const mockDiffSchema = vi.fn(() => ({
        addedFields: ['date_of_birth'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSchema = vi.fn(() => ({ type: 'object', fields: {} }));
      const mockAskApproval = vi.fn(() => Promise.resolve(true));
      const mockPerformSelfHealingUpdate = vi.fn(() => Promise.resolve(true));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        performSelfHealingUpdate: mockPerformSelfHealingUpdate,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(mockAskApproval).toHaveBeenCalledTimes(1);
      expect(mockAskApproval).toHaveBeenCalledWith(
        expect.stringContaining('date_of_birth')
      );
    });

    it('does not call askApproval when no fields are added', async () => {
      const mockSendNotification = vi.fn();
      const mockDiffSchema = vi.fn(() => ({
        addedFields: [],
        removedFields: ['old_field'],
        modifiedFields: [],
      }));
      const mockReadSchema = vi.fn(() => ({ type: 'object', fields: {} }));
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(mockAskApproval).not.toHaveBeenCalled();
    });

    it('logs rejection message when developer rejects update', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockDiffSchema = vi.fn(() => ({
        addedFields: ['date_of_birth'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSchema = vi.fn(() => ({ type: 'object', fields: {} }));
      const mockAskApproval = vi.fn(() => Promise.resolve(false));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('rejected')
      );
      consoleSpy.mockRestore();
    });

    it('logs approval message when developer approves update', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockDiffSchema = vi.fn(() => ({
        addedFields: ['date_of_birth'],
        removedFields: [],
        modifiedFields: [],
      }));
      const mockReadSchema = vi.fn(() => ({ type: 'object', fields: {} }));
      const mockAskApproval = vi.fn(() => Promise.resolve(true));
      const mockPerformSelfHealingUpdate = vi.fn(() => Promise.resolve(true));

      let onChangeHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onChangeHandler = options.onChange;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: vi.fn(),
        diffSchema: mockDiffSchema,
        readSchemaFn: mockReadSchema,
        askApproval: mockAskApproval,
        performSelfHealingUpdate: mockPerformSelfHealingUpdate,
        schemaPath,
      });

      await onChangeHandler(schemaPath);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('approved')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('onError behavior', () => {
    it('sends notification when schema file becomes inaccessible', () => {
      const mockSendNotification = vi.fn();

      let onErrorHandler;
      const mockCreateFileWatcher = vi.fn((filePath, options) => {
        onErrorHandler = options.onError;
        return { close: vi.fn(() => Promise.resolve()) };
      });

      start({
        createFileWatcher: mockCreateFileWatcher,
        sendNotification: mockSendNotification,
        diffSchema: vi.fn(),
        readSchemaFn: vi.fn(() => null),
        schemaPath,
      });

      // Trigger the error handler
      onErrorHandler(new Error('ENOENT: file not found'));

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'API_Project',
          message: expect.stringContaining('no longer accessible'),
        })
      );
    });
  });
});
