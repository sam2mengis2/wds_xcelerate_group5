import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// Frontend runs on 5173; any request to /api is forwarded to the Express server,
// so client code can just call fetch('/api/...') with no CORS setup in dev.
export default defineConfig({
  plugins: [
    // Must come before react(). Watches src/routes/ and regenerates src/routeTree.gen.ts.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  // `@/...` points at client/src. Keep in sync with "paths" in tsconfig.json.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
