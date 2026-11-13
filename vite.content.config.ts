import { defineConfig } from 'vite';

// Content scripts cannot be ES modules, so they are bundled as a classic
// IIFE into a single content.js. This build runs first and clears dist/.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    minify: false,
    lib: {
      entry: 'src/content/index.ts',
      name: 'Risovach',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});