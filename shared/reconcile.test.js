import { describe, it, expect, vi } from 'vitest';
import { reconcileNode, buildUserPrompt, languageForFile, parseEditBlocks, applyEditBlocks } from './reconcile.js';

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

describe('parseEditBlocks', () => {
  it('parses a single search/replace block', () => {
    const response = `<<<<<<< SEARCH
const fields = ['name'];
=======
const fields = ['name', 'age'];
>>>>>>> REPLACE`;

    const blocks = parseEditBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].search).toBe("const fields = ['name'];");
    expect(blocks[0].replace).toBe("const fields = ['name', 'age'];");
  });

  it('parses multiple edit blocks', () => {
    const response = `<<<<<<< SEARCH
line1
=======
line1_updated
>>>>>>> REPLACE

<<<<<<< SEARCH
line2
=======
line2_updated
>>>>>>> REPLACE`;

    const blocks = parseEditBlocks(response);
    expect(blocks).toHaveLength(2);
  });

  it('returns empty array for no-change response', () => {
    expect(parseEditBlocks('NO_CHANGES_NEEDED')).toHaveLength(0);
  });
});

describe('applyEditBlocks', () => {
  it('applies a single block to file content', () => {
    const content = "const x = 1;\nconst y = 2;\nconst z = 3;";
    const blocks = [{ search: 'const y = 2;', replace: 'const y = 42;' }];

    const { result, applied, failed } = applyEditBlocks(content, blocks);
    expect(applied).toBe(1);
    expect(failed).toHaveLength(0);
    expect(result).toContain('const y = 42;');
    expect(result).toContain('const x = 1;');
  });

  it('reports failure when search string is not found', () => {
    const content = 'hello world';
    const blocks = [{ search: 'goodbye', replace: 'hi' }];

    const { result, applied, failed } = applyEditBlocks(content, blocks);
    expect(applied).toBe(0);
    expect(failed).toHaveLength(1);
    expect(result).toBe('hello world');
  });

  it('reports failure when search string is ambiguous', () => {
    const content = 'aaa\nbbb\naaa';
    const blocks = [{ search: 'aaa', replace: 'ccc' }];

    const { result, applied, failed } = applyEditBlocks(content, blocks);
    expect(applied).toBe(0);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain('ambiguous');
  });
});

describe('reconcileNode', () => {
  it('applies edit blocks and returns true when verify passes', async () => {
    const editResponse = `<<<<<<< SEARCH
ORIGINAL CONTENT
=======
UPDATED CONTENT
>>>>>>> REPLACE`;
    const callLLM = vi.fn().mockResolvedValue(editResponse);
    const runVerify = vi.fn().mockResolvedValue({ success: true, output: '' });
    const { files, notifications, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(true);
    expect(files.get('/abs/fake/owned.js')).toBe('UPDATED CONTENT');
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(runVerify).toHaveBeenCalledTimes(1);
    expect(notifications.at(-1).title).toContain('Reconciled');
  });

  it('handles NO_CHANGES_NEEDED response', async () => {
    const callLLM = vi.fn().mockResolvedValue('NO_CHANGES_NEEDED');
    const runVerify = vi.fn().mockResolvedValue({ success: true, output: '' });
    const { files, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(true);
    expect(files.get('/abs/fake/owned.js')).toBe('ORIGINAL CONTENT');
  });

  it('falls back to whole-file extraction when no edit blocks found', async () => {
    const callLLM = vi.fn().mockResolvedValue('```javascript\nFALLBACK CONTENT\n```');
    const runVerify = vi.fn().mockResolvedValue({ success: true, output: '' });
    const { files, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(true);
    expect(files.get('/abs/fake/owned.js')).toBe('FALLBACK CONTENT');
  });

  it('retries with the verify error fed back, then succeeds', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValueOnce('<<<<<<< SEARCH\nORIGINAL CONTENT\n=======\nFIRST ATTEMPT\n>>>>>>> REPLACE')
      .mockResolvedValueOnce('<<<<<<< SEARCH\nFIRST ATTEMPT\n=======\nSECOND ATTEMPT\n>>>>>>> REPLACE');
    const runVerify = vi
      .fn()
      .mockResolvedValueOnce({ success: false, output: 'SyntaxError: boom on line 3' })
      .mockResolvedValueOnce({ success: true, output: '' });
    const { files, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode(), oldContract, newContract, deps);

    expect(ok).toBe(true);
    expect(files.get('/abs/fake/owned.js')).toBe('SECOND ATTEMPT');
    expect(callLLM).toHaveBeenCalledTimes(2);
    const secondUserPrompt = callLLM.mock.calls[1][1];
    expect(secondUserPrompt).toContain('SyntaxError: boom on line 3');
  });

  it('reverts owned files and returns false when it cannot converge', async () => {
    const callLLM = vi.fn().mockResolvedValue('<<<<<<< SEARCH\nORIGINAL CONTENT\n=======\nBROKEN\n>>>>>>> REPLACE');
    const runVerify = vi.fn().mockResolvedValue({ success: false, output: 'still failing' });
    const { files, notifications, deps } = makeDeps({ callLLM, runVerify });

    const ok = await reconcileNode(makeNode({ maxReconcileAttempts: 2 }), oldContract, newContract, deps);

    expect(ok).toBe(false);
    expect(files.get('/abs/fake/owned.js')).toBe('ORIGINAL CONTENT');
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(runVerify).toHaveBeenCalledTimes(2);
    expect(notifications.at(-1).title).toContain('Failed');
  });

  it('returns false without calling verify if an owned file cannot be read', async () => {
    const callLLM = vi.fn();
    const runVerify = vi.fn();
    const { notifications, deps } = makeDeps({ callLLM, runVerify });
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

  it('buildUserPrompt includes verify error on retry', () => {
    const prompt = buildUserPrompt({
      goal: 'g',
      oldContract,
      newContract,
      filePath: 'f.js',
      currentContent: 'c',
      verifyError: 'TypeError: x is undefined',
    });
    expect(prompt).toContain('did not pass verification');
    expect(prompt).toContain('TypeError: x is undefined');
  });
});
