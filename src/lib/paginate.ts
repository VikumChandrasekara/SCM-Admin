/** Rows on a page, in every list in the panel. */
export const PAGE_SIZE = 100;

export interface PageWindow {
  /** The page shown, 1-based, after being pulled into range. */
  page: number;
  /** How many pages the list fills — at least 1, so an empty list is still "page 1". */
  pages: number;
  /** Index of the first row on the page. */
  start: number;
  /** Index one past the last row on the page. */
  end: number;
}

/**
 * What the page controls need to know, whether the whole list is in hand
 * (usePagination) or only the page on screen is (useLivePages).
 */
export interface Pager {
  /** 1-based. */
  page: number;
  /** Known only when the whole list is in hand. */
  pages: number | null;
  /** Position of the first and last row shown, 1-based; 0 and 0 for an empty page. */
  first: number;
  last: number;
  /** Rows in the whole list, when that is known. */
  total: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
  previous: () => void;
  next: () => void;
}

/** Where [page] of a list of [total] rows falls. A page out of range is moved to the nearest one. */
export function pageWindow(total: number, page: number, size = PAGE_SIZE): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const shown = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const start = (shown - 1) * size;
  return { page: shown, pages, start, end: Math.min(start + size, total) };
}
