import { describe, it, expect, vi } from 'vitest';
import { start, NODE_ID } from './agentic-loop.js';

describe('ui-project/agentic-loop (thin entry point)', () => {
  it('resolves the "ui" node and watches the swagger contract it consumes', () => {
    expect(NODE_ID).toBe('ui');

    let watchedPath;
    const handle = start({
      createFileWatcher: (path) => {
        watchedPath = path;
        return { close: vi.fn().mockResolvedValue(undefined) };
      },
    });

    expect(watchedPath).toMatch(/api-project[\\/]swagger\.json$/);
    expect(typeof handle.stop).toBe('function');
  });
});
