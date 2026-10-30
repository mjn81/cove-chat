import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import path from 'path'

// Content-Security-Policy for production builds (the dev server needs inline scripts for hot reload, so it is
// not applied there). The server URL is user-chosen, hence the open connect-src; everything that executes is
// restricted to this origin. 'wasm-unsafe-eval' is required by the zstd WebAssembly module.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss: blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const cspPlugin = () => ({
  name: 'cove-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
