import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    // Including react-dom/client (used by src/main.jsx) ensures the client API
    // is pre-bundled alongside react/react-dom so they share one module
    // instance — and any change here invalidates a stale .vite/deps cache
    // (which otherwise causes "dispatcher.useState is null" hook errors).
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    // Never let the browser cache dev JS/CSS. A stale cached Vite chunk or
    // /src module (served with an outdated source map) is what produces the
    // "dispatcher.useState is null" error in the preview. no-store forces a
    // fresh fetch on every reload. (Dev-server only; prod serves hashed assets.)
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});