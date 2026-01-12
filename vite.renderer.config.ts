import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react({
    babel: {
      plugins: []
    }
  })],
  server: {
    host: 'localhost',
    port: 4173
  },
  preview: {
    host: 'localhost',
    port: 4173
  },
  build: {
    outDir: 'dist/renderer'
  }
});
