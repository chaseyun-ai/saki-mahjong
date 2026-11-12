import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // 没写超时的测试最多跑 30 秒（默认 5 秒）。本机 CI 忙的时候一个测试会慢五到八倍，
    // 写了超时的长测试都留到这台云端机器上实测用时的 10 倍以上
    testTimeout: 30000,
  },
});
