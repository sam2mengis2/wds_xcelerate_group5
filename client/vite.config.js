import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend runs on 5173; any request to /api is forwarded to the Express server,
// so client code can just call fetch('/api/...') with no CORS setup in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
