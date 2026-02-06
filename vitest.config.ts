import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
    exclude: ['src/renderer/**'],
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main')
    },
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/main/index.ts',
        'src/renderer/**'
      ]
    }
  },
});
