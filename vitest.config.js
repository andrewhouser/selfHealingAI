import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    exclude: [
      'node_modules/**',
      'ui-project/__tests__/PersonTable.property.test.tsx',
    ],
  },
});
