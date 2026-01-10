import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/**/*.test.tsx', 'src/renderer/**/*.test.ts'],
    setupFiles: ['src/renderer/test/setup.ts'],
    globals: true
  },
});
