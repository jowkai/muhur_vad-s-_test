import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Three.js is the bulk of the bundle and changes far less often than the game code, so it
        // gets its own chunk and stays cached across releases.
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
