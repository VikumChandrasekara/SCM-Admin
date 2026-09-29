import { readFile } from 'node:fs/promises';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Puts the service worker beside the built panel with the build written into
 * it, which names the cache it keeps: each deploy starts a fresh one and the
 * files of the last are cleared away. It is kept out of `public/` because
 * what lands there is copied across untouched.
 */
function serviceWorker(): Plugin {
  const build = Date.now().toString(36);
  return {
    name: 'scm-service-worker',
    apply: 'build',
    async generateBundle() {
      const source = await readFile(new URL('src/sw.js', import.meta.url), 'utf8');
      if (!source.includes('__BUILD_ID__')) {
        // Without it every deploy would share one cache name and go on
        // serving the files of the one before it.
        throw new Error('src/sw.js has no __BUILD_ID__ for the build to be written into.');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source.replace('__BUILD_ID__', build) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
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
