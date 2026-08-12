import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_OUTPUT_CONTRACT_MANIFEST = 'build-output-contract-manifest.json';

// Mirrors the production header CSP in src/main/app/securityHeaders.ts as a
// defense-in-depth <meta> fallback for the packaged file:// load. connect-src
// stays scheme-wide here because the PocketBase origin is configured at
// runtime; the dynamic header narrows it to a single origin.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' http: https: ws: wss:",
  "font-src 'self' data:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function injectCspMeta(): import('vite').Plugin {
  return {
    name: 'relay-inject-csp-meta',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
      );
    },
  };
}

function rendererManualChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/');

  if (normalizedId.includes('/node_modules/pdfjs-dist/build/pdf.mjs')) {
    return 'pdf-vendor';
  }
  if (
    normalizedId === '\0commonjsHelpers.js' ||
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'react-vendor';
  }
  if (normalizedId.includes('/node_modules/@dnd-kit/')) {
    return 'dnd-vendor';
  }
  if (
    normalizedId.includes('/node_modules/react-window/') ||
    normalizedId.includes('/node_modules/react-virtualized-auto-sizer/')
  ) {
    return 'virtual-vendor';
  }

  return undefined;
}

function mainManualChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/');
  return normalizedId.endsWith('/src/main/dynatrace/DynatraceProblemsClient.ts')
    ? 'dynatrace-problems-client'
    : undefined;
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'dist/main',
      minify: 'esbuild',
      sourcemap: process.env.NODE_ENV === 'development',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          knowledgeExtractorWorker: resolve(
            __dirname,
            'src/main/knowledge/knowledgeExtractor.worker.ts',
          ),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          manualChunks: mainManualChunk,
          onlyExplicitManualChunks: true,
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'dist/preload',
      minify: 'esbuild',
      sourcemap: process.env.NODE_ENV === 'development',
      rollupOptions: {
        output: {
          format: 'cjs',
          inlineDynamicImports: true,
          entryFileNames: '[name].cjs',
        },
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [react(), injectCspMeta()],
    server: {
      hmr: {
        overlay: false,
      },
    },
    build: {
      ...(process.env.RELAY_BUILD_OUTPUT_CONTRACT === '1'
        ? { manifest: BUILD_OUTPUT_CONTRACT_MANIFEST }
        : {}),
      outDir: 'dist/renderer',
      minify: 'esbuild',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks: rendererManualChunk,
          onlyExplicitManualChunks: true,
          chunkFileNames: 'js/[name]-[hash].js',
          entryFileNames: 'js/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      target: 'esnext',
      reportCompressedSize: false,
      sourcemap: process.env.NODE_ENV === 'development',
    },
  },
});
