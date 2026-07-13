import { describe, it, expect, vi } from 'vitest';
import { createAskApproval } from './approval-prompt.js';

describe('ui-project/approval-prompt', () => {
  describe('createAskApproval()', () => {
    it('returns a function', () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('y'),
          close: () => {},
        }),
      });
      expect(typeof askApproval).toBe('function');
    });

    it('resolves with true when user answers "y"', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('y'),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(true);
    });

    it('resolves with true when user answers "yes"', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('yes'),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(true);
    });

    it('resolves with true when user answers "Y" (case-insensitive)', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('Y'),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(true);
    });

    it('resolves with false when user answers "n"', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('n'),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(false);
    });

    it('resolves with false when user answers "no"', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('no'),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(false);
    });

    it('resolves with false for any non-affirmative answer', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('maybe'),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(false);
    });

    it('includes the message and (y/n) suffix in the prompt', async () => {
      let capturedMessage = '';
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => {
            capturedMessage = msg;
            cb('y');
          },
          close: () => {},
        }),
      });
      await askApproval('Apply update?');
      expect(capturedMessage).toBe('Apply update? (y/n): ');
    });

    it('closes the readline interface after receiving answer', async () => {
      const closeFn = vi.fn();
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('y'),
          close: closeFn,
        }),
      });
      await askApproval('Test prompt');
      expect(closeFn).toHaveBeenCalledTimes(1);
    });

    it('trims whitespace from user input', async () => {
      const askApproval = createAskApproval({
        createReadlineInterface: () => ({
          question: (msg, cb) => cb('  y  '),
          close: () => {},
        }),
      });
      const result = await askApproval('Test prompt');
      expect(result).toBe(true);
    });
  });
});
