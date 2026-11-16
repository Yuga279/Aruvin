import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.FRONTEND_PORT ?? 5173),
    proxy: {
      '/api': {
        target: process.env.BACKEND_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ error: { code: 'NOT_READY', retryable: true } }));
            }
          });
        },
      },
    },
  },
})
