import { describe, expect, it } from 'vitest';

import { pageOf } from '../src/data/live';
import { PAGE_SIZE, pageWindow } from '../src/lib/paginate';

describe('pageOf', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => index);

  it('shows a page of 100 and says another follows when it was handed a 101st', () => {
    const { shown, more } = pageOf(rows(101));
    expect(shown).toHaveLength(100);
    expect(shown[99]).toBe(99);
    expect(more).toBe(true);
  });

  it('says nothing follows a page that is exactly full', () => {
    expect(pageOf(rows(100))).toMatchObject({ more: false });
    expect(pageOf(rows(100)).shown).toHaveLength(100);
  });

  it('shows a short page whole', () => {
    expect(pageOf(rows(3))).toEqual({ shown: [0, 1, 2], more: false });
    expect(pageOf([])).toEqual({ shown: [], more: false });
  });
});

describe('pageWindow', () => {
  it('shows 100 rows to a page', () => {
    expect(PAGE_SIZE).toBe(100);
  });

  it('keeps a short list on one page', () => {
    expect(pageWindow(0, 1)).toEqual({ page: 1, pages: 1, start: 0, end: 0 });
    expect(pageWindow(37, 1)).toEqual({ page: 1, pages: 1, start: 0, end: 37 });
    expect(pageWindow(100, 1)).toEqual({ page: 1, pages: 1, start: 0, end: 100 });
  });

  it('starts a second page at row 101', () => {
    expect(pageWindow(101, 1)).toEqual({ page: 1, pages: 2, start: 0, end: 100 });
    expect(pageWindow(101, 2)).toEqual({ page: 2, pages: 2, start: 100, end: 101 });
  });

  it('ends the last page where the list does', () => {
    expect(pageWindow(342, 4)).toEqual({ page: 4, pages: 4, start: 300, end: 342 });
  });

  it('pulls a page out of range back in — a list that shrank under the reader', () => {
    expect(pageWindow(150, 5)).toMatchObject({ page: 2, start: 100, end: 150 });
    expect(pageWindow(40, 3)).toMatchObject({ page: 1, start: 0, end: 40 });
    expect(pageWindow(40, 0)).toMatchObject({ page: 1 });
    expect(pageWindow(40, -2)).toMatchObject({ page: 1 });
    expect(pageWindow(40, Number.NaN)).toMatchObject({ page: 1 });
  });

  it('takes a page size of its own', () => {
    expect(pageWindow(25, 2, 10)).toEqual({ page: 2, pages: 3, start: 10, end: 20 });
  });
});
