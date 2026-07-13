import { describe, it, expect, vi } from 'vitest';
import { askApproval, createAskApproval } from './approval-prompt.js';

/**
 * Creates a mock readline interface that simulates user input.
 * @param {string} answer - The simulated user answer
 * @returns {Object} Mock readline interface with question and close methods
 */
function createMockRl(answer) {
  return {
    question: vi.fn((prompt, callback) => {
      callback(answer);
    }),
    close: vi.fn(),
  };
}

describe('api-project/approval-prompt', () => {
  describe('module exports', () => {
    it('exports askApproval as a function', () => {
      expect(typeof askApproval).toBe('function');
    });

    it('exports createAskApproval as a factory function', () => {
      expect(typeof createAskApproval).toBe('function');
    });
  });

  describe('createAskApproval()', () => {
    it('returns a function', () => {
      const fn = createAskApproval({ createReadlineInterface: () => createMockRl('y') });
      expect(typeof fn).toBe('function');
    });
  });

  describe('askApproval() — approval behavior', () => {
    it('resolves with true when user types "y"', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('y') });
      const result = await ask('Apply update?');
      expect(result).toBe(true);
    });

    it('resolves with true when user types "yes"', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('yes') });
      const result = await ask('Apply update?');
      expect(result).toBe(true);
    });

    it('resolves with true when user types "Y" (case insensitive)', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('Y') });
      const result = await ask('Apply update?');
      expect(result).toBe(true);
    });

    it('resolves with true when user types "YES" (case insensitive)', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('YES') });
      const result = await ask('Apply update?');
      expect(result).toBe(true);
    });

    it('resolves with true when input has leading/trailing whitespace', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('  yes  ') });
      const result = await ask('Apply update?');
      expect(result).toBe(true);
    });
  });

  describe('askApproval() — rejection behavior', () => {
    it('resolves with false when user types "n"', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('n') });
      const result = await ask('Apply update?');
      expect(result).toBe(false);
    });

    it('resolves with false when user types "no"', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('no') });
      const result = await ask('Apply update?');
      expect(result).toBe(false);
    });

    it('resolves with false for any non-affirmative input', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('maybe') });
      const result = await ask('Apply update?');
      expect(result).toBe(false);
    });

    it('resolves with false for empty input', async () => {
      const ask = createAskApproval({ createReadlineInterface: () => createMockRl('') });
      const result = await ask('Apply update?');
      expect(result).toBe(false);
    });
  });

  describe('askApproval() — prompt formatting', () => {
    it('includes the message in the prompt displayed to the user', async () => {
      const mockRl = createMockRl('y');
      const ask = createAskApproval({ createReadlineInterface: () => mockRl });

      await ask('Schema change detected: new field date_of_birth');

      const promptArg = mockRl.question.mock.calls[0][0];
      expect(promptArg).toContain('Schema change detected: new field date_of_birth');
      expect(promptArg).toContain('(y/n)');
    });

    it('closes the readline interface after receiving input', async () => {
      const mockRl = createMockRl('y');
      const ask = createAskApproval({ createReadlineInterface: () => mockRl });

      await ask('Apply update?');
      expect(mockRl.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('askApproval() — waits indefinitely', () => {
    it('does not resolve until the readline callback is invoked', async () => {
      let resolveQuestion;
      const mockRl = {
        question: vi.fn((prompt, callback) => {
          // Store callback but don't call it immediately
          resolveQuestion = callback;
        }),
        close: vi.fn(),
      };
      const ask = createAskApproval({ createReadlineInterface: () => mockRl });

      let resolved = false;
      const promise = ask('Apply update?').then((result) => {
        resolved = true;
        return result;
      });

      // Give a tick for the promise to potentially resolve
      await new Promise((r) => setTimeout(r, 50));
      expect(resolved).toBe(false);

      // Now simulate the user responding
      resolveQuestion('yes');
      const result = await promise;
      expect(resolved).toBe(true);
      expect(result).toBe(true);
    });
  });
});
