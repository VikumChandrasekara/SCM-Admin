import type { WriteBatch } from 'firebase/firestore';

import { errorMessage } from '../lib/errors';

/** How long a save waits on the server before the panel carries on. */
const WAIT_MS = 4000;

/**
 * Commits [batch] without letting a weak connection hold the panel up.
 *
 * The write reaches the local cache — and the screen — at once. When the
 * server has not confirmed it within a few seconds the panel moves on anyway:
 * the write stays queued on this computer (a reload does not lose it) and is
 * sent as soon as the connection allows. A refusal that arrives quickly is
 * thrown to the caller as usual; one that arrives later is still announced.
 */
export async function commit(batch: WriteBatch): Promise<void> {
  const sent = batch.commit();
  const late = new Promise<'late'>((resolve) => window.setTimeout(() => resolve('late'), WAIT_MS));
  const outcome = await Promise.race([sent.then(() => 'sent' as const), late]);
  if (outcome === 'late') {
    window.dispatchEvent(new CustomEvent('scm:write-queued'));
    sent.catch((error: unknown) =>
      window.dispatchEvent(new CustomEvent('scm:write-failed', { detail: errorMessage(error) })),
    );
  }
}
