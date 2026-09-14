import { RotateCcw, WifiOff } from 'lucide-react';
import { Component, type ReactNode } from 'react';

import { Button, cx } from './ui';

/**
 * Catches a page that could not be shown — most often because its code
 * failed to download on a weak line — and offers a retry, where React would
 * otherwise leave a blank screen. Give it a `key` that changes with the page,
 * so moving to another page tries afresh.
 */
export class PageBoundary extends Component<
  { children: ReactNode; fullScreen?: boolean },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className={cx(
          'flex flex-col items-center justify-center gap-3 px-6 text-center',
          this.props.fullScreen ? 'min-h-screen' : 'py-20',
        )}
      >
        <WifiOff className="size-9 text-white/50" />
        <p className="text-lg font-extrabold">මෙම පිටුව පෙන්වීමට නොහැකි විය</p>
        <p className="max-w-sm text-sm text-white/65">අන්තර්ජාල සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.</p>
        <Button icon={<RotateCcw className="size-4" />} onClick={() => window.location.reload()}>
          නැවත උත්සාහ කරන්න
        </Button>
      </div>
    );
  }
}
