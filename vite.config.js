import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
  server: {port: 5181, strictPort: true},
});
