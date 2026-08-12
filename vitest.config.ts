import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // The camera page is plain JS on purpose — it ships to a phone with no build
    // step — but its ring buffer is real logic and gets tested like everything else.
    include: ['src/**/*.test.ts', 'web/**/*.test.ts', 'web/**/*.test.js'],
  },
});
