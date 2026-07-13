import { describe, it, expect, vi } from 'vitest';
import { reconcileNode, buildUserPrompt, languageForFile } from './reconcile.js';

/**
 * A minimal node fixture owning a single fake file.
 */
function makeNode(overrides = {}) {
  return {
    id: 'test',
    project: 'Test_Project',
    goal: 'Keep the file consistent with the contract.',
    owns: ['fake/owned.js'],
    ownsPaths: ['/abs/fake/owned.js'],
    verify: 'echo ok',
    maxReconcileAttempts: 2,
    ...overrides,
  };
}

/**
 * In-memory filesystem + notification capture, wired as reconcile deps.
 */
function makeDeps({ callLLM, runVerify, initial = 'ORIGINAL CONTENT' } = {}) {
  const files = new Map([['/abs/fake/owned.js', initial]]);
  const notifications = [];
  return {
    files,
    notifications,
    deps: {
      readFile: (p) => {
        if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return files.get(p);
      },
      writeFile: (p, content) => files.set(p, content),
      callLLM,
      runVerify,
      sendNotification: (n) => { notifications.push(n); return Promise.resolve(); },
    },
  };
}

const oldContract = { fields: { name: {} } };
const newContract = { fields: { name: {}, age: {} } };

describe('reconcileNode', () => {
  it('writes the reconciled file and returns true when verify passes first try', async () => {
    const callLLM = vi.fn().mockResolvedValue('UPDATED CONTENT');
    const runVerify = vi.fn().mockReturnValue({ success: true, output: '' });
    const { files, notifications, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(true);
    expect(files.get('/abs/fake/owned.js')).toBe('UPDATED CONTENT');
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(runVerify).toHaveBeenCalledTimes(1);
    expect(notifications.at(-1).title).toContain('Reconciled');
  });

  it('retries with the verify error fed back, then succeeds', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValueOnce('FIRST ATTEMPT')
      .mockResolvedValueOnce('SECOND ATTEMPT');
    const runVerify = vi
      .fn()
      .mockReturnValueOnce({ success: false, output: 'SyntaxError: boom on line 3' })
      .mockReturnValueOnce({ success: true, output: '' });
    const { files, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(true);
    expect(files.get('/abs/fake/owned.js')).toBe('SECOND ATTEMPT');
    expect(callLLM).toHaveBeenCalledTimes(2);
    // The second prompt must carry the first attempt's verify error.
    const secondUserPrompt = callLLM.mock.calls[1][1];
    expect(secondUserPrompt).toContain('SyntaxError: boom on line 3');
  });

  it('reverts owned files and returns false when it cannot converge', async () => {
    const callLLM = vi.fn().mockResolvedValue('BROKEN CONTENT');
    const runVerify = vi.fn().mockReturnValue({ success: false, output: 'still failing' });
    const { files, notifications, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode({ maxReconcileAttempts: 2 }), oldContract, newContract, deps);

    expect(ok).toBe(false);
    // Reverted to the original content.
    expect(files.get('/abs/fake/owned.js')).toBe('ORIGINAL CONTENT');
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(runVerify).toHaveBeenCalledTimes(2);
    expect(notifications.at(-1).title).toContain('Failed');
  });

  it('returns false without calling verify if an owned file cannot be read', async () => {
    const callLLM = vi.fn();
    const runVerify = vi.fn();
    const { notifications, deps } = makeDeps({ callLLM, runVerify });
    // Point the node at a path that isn't in the in-memory fs.
    const node = makeNode({ ownsPaths: ['/abs/does/not/exist.js'] });

    const ok = await reconcileNode(node, oldContract, newContract, deps);

    expect(ok).toBe(false);
    expect(callLLM).not.toHaveBeenCalled();
    expect(runVerify).not.toHaveBeenCalled();
    expect(notifications.at(-1).title).toContain('Failed');
  });

  it('reverts and returns false if the model call throws', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('LLM unreachable'));
    const runVerify = vi.fn();
    const { files, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(false);
    expect(files.get('/abs/fake/owned.js')).toBe('ORIGINAL CONTENT');
    expect(runVerify).not.toHaveBeenCalled();
  });
});

describe('prompt helpers', () => {
  it('languageForFile maps extensions to fence hints', () => {
    expect(languageForFile('a/b/page.tsx')).toBe('tsx');
    expect(languageForFile('routes/persons.js')).toBe('javascript');
    expect(languageForFile('x.json')).toBe('json');
  });

  it('buildUserPrompt includes goal, both contracts, and the file body', () => {
    const prompt = buildUserPrompt({
      goal: 'GOAL-TEXT',
      oldContract,
      newContract,
      filePath: 'routes/persons.js',
      currentContent: 'FILE-BODY',
    });
    expect(prompt).toContain('GOAL-TEXT');
    expect(prompt).toContain('"age"');
    expect(prompt).toContain('FILE-BODY');
    expect(prompt).not.toContain('did not pass verification');
  });
});
