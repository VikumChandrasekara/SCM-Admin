import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';

import { PAGE_SIZE, pageWindow, type Pager } from '../lib/paginate';
import { Button } from './ui';

/**
 * Splits a list that is wholly in memory into pages of [size] (100).
 *
 * [resetKey] names what the list is *of* — a month, a filter, a search. When it
 * changes the reader is back on page 1; while it stays the same a list that
 * grows or shrinks under them keeps them where they are (or on the last page,
 * if theirs is gone).
 */
export function usePagination<T>(items: readonly T[], resetKey = '', size = PAGE_SIZE) {
  const [at, setAt] = useState({ page: 1, key: resetKey });
  // The page belongs to the list it was chosen in. Forgotten as soon as that
  // list changes — not merely ignored, or going back to the old list would
  // bring the old page back with it.
  if (at.key !== resetKey) setAt({ page: 1, key: resetKey });
  const view = pageWindow(items.length, at.key === resetKey ? at.page : 1, size);
  const go = (page: number) => setAt({ page, key: resetKey });

  const pager: Pager = {
    page: view.page,
    pages: view.pages,
    first: items.length === 0 ? 0 : view.start + 1,
    last: view.end,
    total: items.length,
    hasPrevious: view.page > 1,
    hasNext: view.page < view.pages,
    previous: () => go(view.page - 1),
    next: () => go(view.page + 1),
  };
  return { rows: items.length <= size ? items : items.slice(view.start, view.end), pager };
}

/**
 * Previous / next, with where the reader is. Goes right under the list it
 * pages, and says nothing at all while the list fits on one page.
 */
export function Pagination({ pager }: { pager: Pager }) {
  const root = useRef<HTMLElement>(null);
  if (!pager.hasPrevious && !pager.hasNext) return null;

  const move = (go: () => void) => {
    go();
    bringListIntoView(root.current);
  };

  return (
    <nav ref={root} aria-label="පිටු" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-white/65 tabular-nums" aria-live="polite">
        <b className="text-white">
          {pager.first}–{pager.last}
        </b>
        {pager.total != null && ` / ${pager.total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label="පෙර පිටුව"
          icon={<ChevronLeft className="size-4" />}
          disabled={!pager.hasPrevious}
          onClick={() => move(pager.previous)}
        >
          පෙර
        </Button>
        <span className="min-w-20 text-center text-xs font-semibold text-white/75 tabular-nums">
          පිටුව {pager.page}
          {pager.pages != null && ` / ${pager.pages}`}
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label="ඊළඟ පිටුව"
          disabled={!pager.hasNext}
          onClick={() => move(pager.next)}
        >
          ඊළඟ
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

/**
 * A new page replaces 100 rows with 100 more, but the buttons are at the foot
 * of them: left alone, the reader would be looking at the bottom of the new
 * page. Brings the top of the list back under the header — only when it has
 * scrolled out of sight, so a short list does not jump.
 */
function bringListIntoView(pager: HTMLElement | null) {
  const list = pager?.previousElementSibling ?? pager?.parentElement;
  if (!list) return;
  const header = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
  const gap = list.getBoundingClientRect().top - header - 8;
  if (gap < 0) window.scrollBy({ top: gap });
}
