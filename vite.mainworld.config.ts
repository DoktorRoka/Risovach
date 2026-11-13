import { defineConfig } from 'vite';

// Main-world companion script. Runs after the content build (which clears
// dist/) and before the module build, so it must not empty dist/.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome111',
    minify: false,
    lib: {
      entry: 'src/main-world/index.ts',
      name: 'RisovachMainWorld',
      formats: ['iife'],
      fileName: () => 'main-world.js',
    },
  },
});
