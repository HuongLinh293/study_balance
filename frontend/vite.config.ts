import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: {
    '/api/user': { target: 'http://127.0.0.1:3001', rewrite: path => path.replace(/^\/api\/user/, '') },
    '/api/task': { target: 'http://127.0.0.1:3002', rewrite: path => path.replace(/^\/api\/task/, '') },
    '/api/planning': { target: 'http://127.0.0.1:3003', rewrite: path => path.replace(/^\/api\/planning/, '') },
    '/api/notification': { target: 'http://127.0.0.1:3004', rewrite: path => path.replace(/^\/api\/notification/, '') },
    '/api/analytics': { target: 'http://127.0.0.1:3005', rewrite: path => path.replace(/^\/api\/analytics/, '') },
  } },
});
