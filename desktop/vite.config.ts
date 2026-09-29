import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  plugins: [react()],
  build: { outDir: '../dist-desktop/app/renderer', emptyOutDir: true, target: 'chrome146', chunkSizeWarningLimit: 1500 },
});
