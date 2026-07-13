import { describe, it, expect, vi } from 'vitest';
import { start, NODE_ID } from './agentic-loop.js';

describe('api-project/agentic-loop (thin entry point)', () => {
  it('resolves the "api" node and watches the schema contract it consumes', () => {
    expect(NODE_ID).toBe('api');

    let watchedPath;
    const handle = start({
      createFileWatcher: (path) => {
        watchedPath = path;
        return { close: vi.fn().mockResolvedValue(undefined) };
      },
    });

    expect(watchedPath).toMatch(/database-project[\\/]schema\.json$/);
    expect(typeof handle.stop).toBe('function');
  });
});
