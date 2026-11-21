import { defineConfig } from 'vitest/config';

// One vitest run for the whole repo. Tests live next to the code in __tests__ folders.
export default defineConfig({
  test: {
    include: ['{shared,server,client,tools}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '.e2e/**'],
    environment: 'node',
  },
});
