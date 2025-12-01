import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:4101';
const wsTarget = proxyTarget.replace(/^http/, 'ws');

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
        target: wsTarget,
        ws: true
      }
    }
  },
  preview: {
    port: 4173
  }
});
