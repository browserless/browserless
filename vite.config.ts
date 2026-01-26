import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    svelte(),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/player/main.ts'),
      formats: ['iife'],
      name: 'RecordingPlayer',
      fileName: () => 'recording-player.js',
    },
    outDir: 'src/generated/player-build',
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      output: {
        // Include all code in a single bundle
        inlineDynamicImports: true,
        // Ensure CSS is extracted
        assetFileNames: '[name][extname]',
        // Use named exports to avoid consumer confusion
        exports: 'named',
      },
    },
    // Target modern browsers (Chrome 90+)
    target: ['chrome90', 'firefox88', 'safari14'],
  },
});
