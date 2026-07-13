import { describe, it, expect } from 'vitest';
import { createAskApproval } from './approval-prompt.js';

/**
 * Builds a fake readline interface that answers with a fixed string.
 */
function fakeInterface(answer) {
  return {
    question(_prompt, cb) {
      cb(answer);
    },
    close() {},
  };
}

describe('shared/approval-prompt', () => {
  it('resolves true for "y" and "yes" (case-insensitive)', async () => {
    for (const answer of ['y', 'Y', 'yes', 'YES', '  yes  ']) {
      const ask = createAskApproval({ createReadlineInterface: () => fakeInterface(answer) });
      expect(await ask('Proceed?')).toBe(true);
    }
  });

  it('resolves false for anything else', async () => {
    for (const answer of ['n', 'no', '', 'maybe', 'ok']) {
      const ask = createAskApproval({ createReadlineInterface: () => fakeInterface(answer) });
      expect(await ask('Proceed?')).toBe(false);
    }
  });
});
