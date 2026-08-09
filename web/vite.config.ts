import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Build target: her Windows 7 PC runs Chrome ~109 (the floor). Her phone
// (Galaxy A31) runs a current Android Chrome. Everything must work on 109.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'chrome109',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        video: resolve(__dirname, 'video/index.html'),
        files: resolve(__dirname, 'files/index.html'),
        reminders: resolve(__dirname, 'reminders/index.html'),
        voice: resolve(__dirname, 'voice/index.html'),
        dev: resolve(__dirname, 'dev/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8077',
      '/s': 'http://localhost:8077',
      '/setup': 'http://localhost:8077',
    },
  },
});
