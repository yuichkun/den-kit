import { defineConfig } from 'vite';

// den-kit runs this dev server inside the pod and shows its pages (the code
// parts) on the plugin. The page reaches it through a forwarded address
// (KIT_HMR_CLIENT_PORT: the port the browser sees), and den-kit's page is
// cross-origin isolated, so every response says it may be embedded there.
export default defineConfig({
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    allowedHosts: true,
    hmr: { overlay: false, ...(process.env.KIT_HMR_CLIENT_PORT ? { clientPort: Number(process.env.KIT_HMR_CLIENT_PORT) } : {}) },
    headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'cross-origin' },
  },
  build: { target: 'es2022' },
});
