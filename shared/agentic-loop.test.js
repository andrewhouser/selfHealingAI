import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startNode, readContract } from './agentic-loop.js';

const CONTRACT_V1 = { fields: { name: { type: 'string' } } };
const CONTRACT_V2 = { fields: { name: { type: 'string' }, age: { type: 'number' } } };

const MOCK_PROPOSALS = [
  { absPath: '/abs/owned.js', displayPath: 'owned.js', original: 'old content', proposed: 'new content' },
];

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
function makeHarness({ contractReads, approval = true, reconcileResult = true, verifyResult = { success: true, output: '' } } = {}) {
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
    proposeChanges: vi.fn().mockResolvedValue(MOCK_PROPOSALS),
    applyProposals: vi.fn(),
    runVerify: vi.fn().mockResolvedValue(verifyResult),
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

  it('proposes changes, shows diff, asks approval, applies, verifies, and runs the producer', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false }, // initial cache
        { data: CONTRACT_V2, parseError: false }, // onChange read
      ],
    });
    const node = makeNode({ producer: { module: 'm', export: 'e' }, produces: 'out.json' });
    startNode(node, harness.deps);

    await harness.captured.onChange();

    expect(harness.deps.proposeChanges).toHaveBeenCalledWith(node, CONTRACT_V1, CONTRACT_V2);
    expect(harness.deps.askApproval).toHaveBeenCalledTimes(1);
    expect(harness.deps.applyProposals).toHaveBeenCalledWith(MOCK_PROPOSALS);
    expect(harness.deps.runVerify).toHaveBeenCalledWith(node.verify);
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
    expect(harness.deps.proposeChanges).not.toHaveBeenCalled();
  });

  it('notifies a parse error and does not propose', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: null, parseError: true },
      ],
    });
    startNode(makeNode(), harness.deps);

    await harness.captured.onChange();

    expect(harness.notifications.at(-1).title).toContain('Parse Error');
    expect(harness.deps.proposeChanges).not.toHaveBeenCalled();
  });

  it('skips applying when the developer rejects the diff', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: CONTRACT_V2, parseError: false },
      ],
      approval: false,
    });
    startNode(makeNode(), harness.deps);

    await harness.captured.onChange();

    expect(harness.deps.proposeChanges).toHaveBeenCalled();
    expect(harness.deps.askApproval).toHaveBeenCalledTimes(1);
    expect(harness.deps.applyProposals).not.toHaveBeenCalled();
    expect(harness.deps.runVerify).not.toHaveBeenCalled();
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

    expect(harness.deps.applyProposals).toHaveBeenCalled();
    expect(harness.deps.runVerify).toHaveBeenCalled();
    expect(harness.deps.runProducer).not.toHaveBeenCalled();
  });

  it('does not fire a second prompt while one is pending', async () => {
    let releaseApproval;
    const approvalPromise = new Promise((resolve) => { releaseApproval = resolve; });

    const readContractFn = vi.fn()
      .mockReturnValueOnce({ data: CONTRACT_V1, parseError: false })
      .mockReturnValueOnce({ data: CONTRACT_V2, parseError: false })
      .mockReturnValueOnce({ data: CONTRACT_V1, parseError: false });

    const captured = {};
    const notifications = [];
    const deps = {
      createFileWatcher: (path, opts) => { captured.onChange = opts.onChange; return { close: vi.fn() }; },
      sendNotification: (n) => { notifications.push(n); return Promise.resolve(); },
      readContractFn,
      proposeChanges: vi.fn().mockResolvedValue(MOCK_PROPOSALS),
      applyProposals: vi.fn(),
      runVerify: vi.fn().mockResolvedValue({ success: true, output: '' }),
      askApproval: vi.fn().mockReturnValue(approvalPromise),
      reconcileNode: vi.fn().mockResolvedValue(true),
      runProducer: vi.fn(),
    };

    const node = makeNode();
    const handle = startNode(node, deps);

    const first = captured.onChange();
    await captured.onChange();

    expect(deps.askApproval).toHaveBeenCalledTimes(1);
    expect(handle.isPromptPending()).toBe(true);

    releaseApproval(true);
    await first;

    expect(deps.applyProposals).toHaveBeenCalledTimes(1);
    expect(handle.isPromptPending()).toBe(false);
  });

  it('retries with reconcileNode when initial verification fails', async () => {
    harness = makeHarness({
      contractReads: [
        { data: CONTRACT_V1, parseError: false },
        { data: CONTRACT_V2, parseError: false },
      ],
      verifyResult: { success: false, output: 'test failed' },
      reconcileResult: true,
    });
    startNode(makeNode(), harness.deps);

    await harness.captured.onChange();

    expect(harness.deps.applyProposals).toHaveBeenCalled();
    expect(harness.deps.runVerify).toHaveBeenCalled();
    // Falls back to full reconcileNode on verify failure
    expect(harness.deps.reconcileNode).toHaveBeenCalled();
  });
});
