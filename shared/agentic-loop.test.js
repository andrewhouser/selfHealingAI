import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startNode, readContract } from './agentic-loop.js';

const CONTRACT_V1 = { fields: { name: { type: 'string' } } };
const CONTRACT_V2 = { fields: { name: { type: 'string' }, age: { type: 'number' } } };

function makeNode(overrides = {}) {
  return {
    id: 'test',
    project: 'Test_Project',
    consumes: 'db/schema.json',
    consumesPath: '/abs/db/schema.json',
    contractPath: ['fields'],
    owns: ['owned.js'],
    ownsPaths: ['/abs/owned.js'],
    goal: 'g',
    verify: 'echo ok',
    maxReconcileAttempts: 2,
    ...overrides,
  };
}

/**
 * Captures the watcher callbacks so the test can drive change events manually.
 */
function makeHarness({ contractReads, approval = true, reconcileResult = true } = {}) {
  const captured = {};
  const notifications = [];
  const readContractFn = vi.fn();
  for (const r of contractReads) readContractFn.mockReturnValueOnce(r);

  const deps = {
    createFileWatcher: (path, opts) => {
      captured.path = path;
      captured.onChange = opts.onChange;
      captured.onError = opts.onError;
      return { close: vi.fn().mockResolvedValue(undefined) };
    },
    sendNotification: (n) => { notifications.push(n); return Promise.resolve(); },
    readContractFn,
    askApproval: vi.fn().mockResolvedValue(approval),
    reconcileNode: vi.fn().mockResolvedValue(reconcileResult),
    runProducer: vi.fn(),
  };
  return { captured, notifications, deps };
}

describe('readContract', () => {
  it('flags malformed JSON as a parse error', () => {
    const res = readContract('/x', () => '{ not json');
    expect(res.parseError).toBe(true);
    expect(res.data).toBeNull();
  });

  it('treats a missing file as inaccessible, not a parse error', () => {
    const res = readContract('/x', () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); });
    expect(res.parseError).toBe(false);
    expect(res.data).toBeNull();
  });
});

describe('startNode', () => {
  let harness;

  it('detects a real change, prompts, reconciles, and runs the producer', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false }, // initial cache
        { data: CONTRACT_V2, parseError: false }, // onChange read
      ],
    });
    const node = makeNode({ producer: { module: 'm', export: 'e' }, produces: 'out.json' });
    startNode(node, harness.deps);

    await harness.captured.onChange();

    expect(harness.deps.askApproval).toHaveBeenCalledTimes(1);
    expect(harness.deps.reconcileNode).toHaveBeenCalledWith(node, CONTRACT_V1, CONTRACT_V2);
    expect(harness.deps.runProducer).toHaveBeenCalledWith(node);
    expect(harness.notifications.some((n) => n.title.includes('Change Detected'))).toBe(true);
  });

  it('does nothing when the contract is unchanged', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: JSON.parse(JSON.stringify(CONTRACT_V1)), parseError: false },
      ],
    });
    startNode(makeNode(), harness.deps);

    await harness.captured.onChange();

    expect(harness.deps.askApproval).not.toHaveBeenCalled();
    expect(harness.deps.reconcileNode).not.toHaveBeenCalled();
  });

  it('notifies a parse error and does not reconcile', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: null, parseError: true },
      ],
    });
    startNode(makeNode(), harness.deps);

    await harness.captured.onChange();

    expect(harness.notifications.at(-1).title).toContain('Parse Error');
    expect(harness.deps.reconcileNode).not.toHaveBeenCalled();
  });

  it('skips reconcile when the developer rejects', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: CONTRACT_V2, parseError: false },
      ],
      approval: false,
    });
    startNode(makeNode(), harness.deps);

    await harness.captured.onChange();

    expect(harness.deps.askApproval).toHaveBeenCalledTimes(1);
    expect(harness.deps.reconcileNode).not.toHaveBeenCalled();
  });

  it('does not run the producer when the node has none', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: CONTRACT_V2, parseError: false },
      ],
    });
    startNode(makeNode(), harness.deps); // no producer

    await harness.captured.onChange();

    expect(harness.deps.reconcileNode).toHaveBeenCalled();
    expect(harness.deps.runProducer).not.toHaveBeenCalled();
  });

  it('does not fire a second prompt while one is pending', async () => {
    // askApproval hangs until we release it, so the first cycle stays "pending".
    let releaseApproval;
    const approvalPromise = new Promise((resolve) => { releaseApproval = resolve; });

    const readContractFn = vi.fn()
      .mockReturnValueOnce({ data: CONTRACT_V1, parseError: false }) // initial cache
      .mockReturnValueOnce({ data: CONTRACT_V2, parseError: false }) // first change
      .mockReturnValueOnce({ data: CONTRACT_V1, parseError: false }); // second change (mid-prompt)

    const captured = {};
    const notifications = [];
    const deps = {
      createFileWatcher: (path, opts) => { captured.onChange = opts.onChange; return { close: vi.fn() }; },
      sendNotification: (n) => { notifications.push(n); return Promise.resolve(); },
      readContractFn,
      askApproval: vi.fn().mockReturnValue(approvalPromise),
      reconcileNode: vi.fn().mockResolvedValue(true),
      runProducer: vi.fn(),
    };

    const node = makeNode();
    const handle = startNode(node, deps);

    const first = captured.onChange();   // enters pending, awaits approval
    await captured.onChange();           // arrives mid-prompt — must not prompt again

    expect(deps.askApproval).toHaveBeenCalledTimes(1);
    expect(handle.isPromptPending()).toBe(true);

    releaseApproval(true);
    await first;

    // Reconcile ran against the latest cached contract folded in during the pending window.
    expect(deps.reconcileNode).toHaveBeenCalledTimes(1);
    expect(handle.isPromptPending()).toBe(false);
  });
});
