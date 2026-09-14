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

// The app itself is kept on this computer for the next visit, so a weak
// connection only has to carry data. Development builds are left alone — the
// dev server rebuilds them on the fly.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {});
    // What this first visit downloaded before the worker was running is
    // handed over too, so the very next visit already works offline. It comes
    // out of the browser's own cache — nothing is downloaded twice.
    void navigator.serviceWorker.ready.then((registration) => {
      const urls = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(`${location.origin}/assets/`));
      registration.active?.postMessage({ type: 'cache-assets', urls });
    });
  });
}
