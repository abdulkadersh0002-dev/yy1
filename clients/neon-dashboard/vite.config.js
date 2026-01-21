import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:4101';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true
      },
      '/metrics': {
        target: proxyTarget,
        changeOrigin: true
      },
      '/ws': {
        target: proxyTarget,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (error, _req, res) => {
            // Ignore expected disconnects during backend restarts.
            if (error && error.code === 'ECONNRESET') {
              return;
            }

            // NOTE: For WS proxy failures, `res` can be a Socket (no writeHead), not an HTTP response.
            // Only attempt to send a 502 when we actually have an HTTP-like response object.
            if (
              res &&
              typeof res.writeHead === 'function' &&
              typeof res.end === 'function' &&
              !res.headersSent
            ) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('WebSocket proxy error');
              return;
            }

            // Best-effort close for socket-like objects.
            if (res && typeof res.end === 'function') {
              try {
                res.end();
              } catch (_e) {
                // best-effort
              }
            }
          });
        }
      }
    }
  },
  preview: {
    port: 4173
  }
});
