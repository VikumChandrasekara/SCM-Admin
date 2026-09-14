import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Names the service worker's cache, so each deploy starts a fresh one and
    // the files of the last one are cleared away.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  build: {
    rolldownOptions: {
      output: {
        // The libraries change far less often than the panel does. In files of
        // their own, a deploy only sends what changed and the browser keeps
        // the rest cached.
        codeSplitting: {
          // A group also takes in whatever its modules depend on, so the order
          // matters: the core claims app, auth and their helpers first, and
          // Firestore — which only the signed-in pages need — gets the rest.
          // The login screen then loads the core alone.
          groups: [
            {
              name: 'firebase-core',
              priority: 30,
              test: /node_modules[\\/](@firebase[\\/](app|auth|component|logger|util)|firebase[\\/](app|auth))[\\/]/,
            },
            {
              name: 'firebase-firestore',
              priority: 20,
              test: /node_modules[\\/](@firebase[\\/](firestore|webchannel-wrapper)|firebase[\\/]firestore)[\\/]/,
            },
            {
              name: 'react',
              priority: 10,
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
});
