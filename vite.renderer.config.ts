import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
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
