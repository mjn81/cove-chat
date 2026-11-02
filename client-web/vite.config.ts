import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import path from 'path'
import { readFileSync } from 'fs'

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

// The build's own semver, sent in X-Cove-Client and compared with the server's min_client_version.
const appVersion = (JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }).version

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
