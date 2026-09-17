import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',

  build: {
    outDir: 'dist',
    // Target modern browsers that support top-level await (Telegram WebView is Chromium-based)
    target: 'es2022',
    rollupOptions: {
      input: 'index.html',
    },
    assetsInlineLimit: 4096,
    sourcemap: true,
  },

  server: {
    port: 3000,
    open: false,
  },

  preview: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['dama-game-6d2b.onrender.com'],
  },

  worker: {
    format: 'es',
  },
});
