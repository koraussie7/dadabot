import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@agentmesh/busabase-adapter': path.resolve(__dirname, './packages/busabase-adapter/src/index.ts'),
      '@agentmesh/affine-adapter': path.resolve(__dirname, './packages/affine-adapter/src/index.ts'),
      '@agentmesh/proposal-bridge': path.resolve(__dirname, './packages/proposal-bridge/src/index.ts'),
      '@agentmesh/dadabot-cli': path.resolve(__dirname, './packages/dadabot-cli/src/cli.ts'),
    },
  },
  server: {
    port: 5173,
    headers: {
      'Content-Security-Policy': csp,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    }
  },
})