import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    // Keep globals for Testing Library's automatic afterEach cleanup.
    globals: true,
    // Preserve the pre-v5 mock lifecycle; suites explicitly clear their own mocks.
    clearMocks: false,
    environment: 'jsdom',
    silent: 'passed-only',
    include: ['src/renderer/**/*.test.tsx', 'src/renderer/**/*.test.ts'],
    setupFiles: ['src/renderer/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: 'coverage/renderer',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/main/**',
        'src/shared/**',
        'src/renderer/test/**',
        'src/renderer/src/main.tsx',
        'src/renderer/src/vite-env.d.ts',
        'src/renderer/src/tabs/notes/index.ts',
        'src/renderer/src/utils/mockData.ts',
      ],
    },
  },
});
