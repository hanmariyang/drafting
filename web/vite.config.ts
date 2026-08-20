import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + share routes to the Fastify backend (default :8080).
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/s': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
