import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { cx } from './ui';

type Tone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(tone: Tone, message: string) => void>(() => {});

const toneStyles: Record<Tone, { className: string; icon: ReactNode }> = {
  success: { className: 'panel-lime text-ink', icon: <CircleCheck className="size-5" /> },
  error: { className: 'bg-alarm text-white', icon: <CircleAlert className="size-5" /> },
  warning: { className: 'chip-signal text-ink', icon: <TriangleAlert className="size-5" /> },
  info: { className: 'panel-blue text-white', icon: <Info className="size-5" /> },
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastQueued = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-3), { id, tone, message }]);
      // Errors stay long enough to be read, and to be acted on.
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  // Saves made on a weak connection (see data/commit.ts) report here.
  useEffect(() => {
    const queued = () => {
      // Once is enough when several saves are waiting together.
      if (Date.now() - lastQueued.current < 8000) return;
      lastQueued.current = Date.now();
      push('info', 'අන්තර්ජාලය මන්දගාමීයි — වෙනස මෙම පරිගණකයේ සුරැකුණා. සම්බන්ධ වූ සැණින් යවයි.');
    };
    const failed = (event: Event) =>
      push('error', `පෙර සුරැකීමක් ප්‍රතික්ෂේප විය: ${(event as CustomEvent<string>).detail}`);
    window.addEventListener('scm:write-queued', queued);
    window.addEventListener('scm:write-failed', failed);
    return () => {
      window.removeEventListener('scm:write-queued', queued);
      window.removeEventListener('scm:write-failed', failed);
    };
  }, [push]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-[380px]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-panel',
              toneStyles[toast.tone].className,
            )}
          >
            <span className="mt-0.5">{toneStyles[toast.tone].icon}</span>
            <p className="flex-1 leading-snug">{toast.message}</p>
            <button
              type="button"
              aria-label="වසන්න"
              onClick={() => dismiss(toast.id)}
              className="rounded-md p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      warning: (message: string) => push('warning', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  );
}
