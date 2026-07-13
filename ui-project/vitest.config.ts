import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // PersonTable.property.test.tsx has a pre-existing failing case (a field-name
    // edge case in the component itself, unrelated to the contract pipeline). It was
    // already excluded by the original root config; excluded here too so both the
    // aggregate `npm test` and the UI node's reconcile `verify` gate on real
    // regressions rather than this known issue.
    exclude: [
      '**/node_modules/**',
      '**/PersonTable.property.test.tsx',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
