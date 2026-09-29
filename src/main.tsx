import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A page left open across a deploy asks for code that is no longer there,
// and a reload picks up the new deploy. When the code is still there and only
// the connection failed, the page says so and offers a retry instead
// (components/PageBoundary.tsx): a reload would only throw away whatever was
// being typed.
let deployCheck: Promise<void> | null = null;
window.addEventListener('vite:preloadError', () => {
  deployCheck ??= reloadIfRedeployed().finally(() => {
    deployCheck = null;
  });
});

async function reloadIfRedeployed(): Promise<void> {
  const entry = document.querySelector('script[type="module"][src]')?.getAttribute('src');
  if (!entry || !navigator.onLine) return;
  try {
    const page = await (await fetch('/index.html', { cache: 'no-store' })).text();
    if (!page.includes(entry)) window.location.reload();
  } catch {
    // The connection, not a deploy.
  }
}

/** How long a panel left open goes before it looks for a new deploy again. */
const DEPLOY_CHECK_MS = 60 * 60 * 1000;

// The app itself is kept on this computer for the next visit, so a weak
// connection only has to carry data. Development builds are left alone — the
// dev server rebuilds them on the fly.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // A worker already driving this page has served it a build of its own — the
  // one this code came out of, or, on a weak signal, an older one it had kept
  // (sw.js). When a newer worker takes the page over it has just cleared those
  // files away, so the page reloads onto the deploy that replaced them. A
  // first install has nothing to replace and takes over in silence.
  const replacing = navigator.serviceWorker.controller != null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!replacing || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // What this first visit downloaded before the worker was running is
        // handed over too, so the very next visit already works offline. It
        // comes out of the browser's own cache — nothing is downloaded twice.
        void navigator.serviceWorker.ready.then((ready) => {
          const urls = performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((url) => url.startsWith(`${location.origin}/assets/`));
          ready.active?.postMessage({ type: 'cache-assets', urls });
        });

        // Registering looks for a newer worker once, which leaves a panel
        // kept open on a phone all day on the deploy it started on — and a
        // phone that fell back to a kept page on an older one still. So it
        // looks again when the panel is brought back up, though not every
        // time: out at the pit that is a request on a signal that is needed
        // for the day's work, and a deploy an hour old is soon enough.
        let checked = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || !navigator.onLine) return;
          if (Date.now() - checked < DEPLOY_CHECK_MS) return;
          checked = Date.now();
          void registration.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}
