import { TriangleAlert } from 'lucide-react';

import { errorMessage } from '../lib/errors';
import { Panel } from './ui';

/**
 * Shown in place of a page whose data was refused, instead of a spinner that
 * would never stop. A refusal on the live project almost always means the
 * security rules there are older than this panel.
 */
export function DataError({ error }: { error: unknown }) {
  const code = (error as { code?: unknown } | null)?.code;
  const refused = code === 'permission-denied';

  return (
    <Panel tone="deep" className="mx-auto mt-6 max-w-2xl p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-signal/15 text-signal">
          <TriangleAlert className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">දත්ත ලබාගත නොහැක</h2>
          <p className="mt-1 text-sm text-white/80">{errorMessage(error)}</p>
          {refused && (
            <div className="mt-4 space-y-2 text-sm text-white/75">
              <p>
                Firebase හි ඇති security rules මෙම පුවරුවට වඩා පැරණි විය හැක — පරිපාලක භූමිකාව සහ ගබඩාව
                ඒවායේ නැත. SCM ව්‍යාපෘතියෙන් නව rules deploy කරන්න:
              </p>
              <pre className="rounded-xl bg-black/30 px-3 py-2 text-xs break-all whitespace-pre-wrap text-amber-hi">
                cd D:\projects\Thrimaa-Interactive\SCM{'\n'}
                ..\SCM-Admin\node_modules\.bin\firebase.cmd deploy --only firestore:rules --project scm-thrimaa
              </pre>
              <p>Deploy කළ පසු මෙම පිටුව refresh කරන්න.</p>
            </div>
          )}
          {!refused && typeof code === 'string' && <p className="mt-2 text-xs text-white/50">{code}</p>}
        </div>
      </div>
    </Panel>
  );
}
