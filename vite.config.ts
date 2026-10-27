import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
});
