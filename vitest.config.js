import { defineConfig } from 'vitest/config';

// Root aggregate runner. Each workspace runs under the environment it needs:
//   - node project: the shared engine, API, database, and integration tests
//   - ui project:   React component tests (jsdom + @vitejs/plugin-react), via
//                   ui-project/vitest.config.ts
//
// This replaces the previous single node-env config (which could not run the
// tsx component tests and had to hard-exclude one file).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: false,
          include: [
            'shared/**/*.test.{js,mjs}',
            'api-project/**/*.test.{js,mjs}',
            'database-project/**/*.test.{js,mjs}',
            'tests/**/*.test.{js,mjs}',
          ],
        },
      },
      './ui-project/vitest.config.ts',
    ],
  },
});
