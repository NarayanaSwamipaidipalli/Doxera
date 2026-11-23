import { describe, expect, it } from 'vitest';
import {
  allExceptFirst, buildDeletePlan, invertSelection, KEEP_ONE_PAGE_ERROR, NOTHING_SELECTED_ERROR, pagesRemovedFileName,
} from '../delete-selection';
import { formatPageSpec, parsePageSpec, selectRange, togglePage } from '../page-selection';

describe('buildDeletePlan', () => {
  it('deletes a single page and keeps the rest in original order', () => {
    expect(buildDeletePlan(5, new Set([3]))).toEqual({
      request: { strictPages: true, pagesToDelete: '3', deletePages: '3' },
      error: null,
      deleting: [3],
      remaining: [1, 2, 4, 5],
    });
  });

  it('deletes multiple pages and ranges, normalised for the backend', () => {
    const plan = buildDeletePlan(12, new Set([12, 2, 5, 8, 9, 10, 11]));
    expect(plan.request?.pagesToDelete).toBe('2, 5, 8-12');
    expect(plan.deleting).toEqual([2, 5, 8, 9, 10, 11, 12]);
    expect(plan.remaining).toEqual([1, 3, 4, 6, 7]);
  });

  it('requires a selection', () => {
    expect(buildDeletePlan(4, new Set())).toMatchObject({ request: null, error: NOTHING_SELECTED_ERROR });
  });

  it('prevents deleting every page, including one-page documents', () => {
    expect(buildDeletePlan(3, new Set([1, 2, 3]))).toMatchObject({ request: null, error: KEEP_ONE_PAGE_ERROR });
    expect(buildDeletePlan(1, new Set([1]))).toMatchObject({ request: null, error: KEEP_ONE_PAGE_ERROR });
    expect(buildDeletePlan(3, new Set([1, 2])).error).toBeNull();
  });

  it('never silently drops out-of-range pages', () => {
    expect(buildDeletePlan(4, new Set([2, 9]))).toMatchObject({
      request: null, error: 'Page 9 is beyond the end of this document (4 pages).',
    });
    expect(buildDeletePlan(4, new Set([0])).request).toBeNull();
  });

  it('blocks the request while the typed input is invalid', () => {
    expect(buildDeletePlan(4, new Set([2]), 'Page 7 is beyond the end of this document (4 pages).')).toMatchObject({
      request: null, error: 'Page 7 is beyond the end of this document (4 pages).',
    });
  });

  it('refuses to plan before the document has loaded', () => {
    expect(buildDeletePlan(0, new Set([1])).request).toBeNull();
  });
});

describe('selection helpers', () => {
  it('selects every page except the first', () => {
    expect(formatPageSpec(allExceptFirst(12))).toBe('2-12');
    expect(allExceptFirst(1).size).toBe(0);
    expect(buildDeletePlan(12, allExceptFirst(12)).remaining).toEqual([1]);
  });

  it('inverts a selection (choose pages to keep, then delete the rest)', () => {
    expect(formatPageSpec(invertSelection(new Set([1, 4]), 6))).toBe('2-3, 5-6');
    expect(invertSelection(new Set(), 3).size).toBe(3);
  });

  it('keeps typed input and thumbnail selection in sync', () => {
    // Typing → thumbnails
    const typed = parsePageSpec('2, 5, 8-12', 12);
    expect(typed.error).toBeNull();
    let selected = new Set(typed.pages);
    // Thumbnail click and shift-click → typed field
    selected = togglePage(selected, 5);
    selected = selectRange(selected, 3, 4, 12);
    expect(formatPageSpec(selected)).toBe('2-4, 8-12');
    expect(buildDeletePlan(12, selected).request?.pagesToDelete).toBe('2-4, 8-12');
  });

  it('rejects invalid typed ranges against the real page count', () => {
    expect(parsePageSpec('2, 14', 12).error).toBe('Page 14 is beyond the end of this document (12 pages).');
    expect(parsePageSpec('6-2', 12).error).toBe('The range "6-2" runs backwards. Write it as 2-6.');
    expect(parsePageSpec('0', 12).error).toBe('Page numbers start at 1 (found 0).');
  });
});

describe('pagesRemovedFileName', () => {
  it('names the output after the original', () => {
    expect(pagesRemovedFileName('Quarterly Plan.pdf')).toBe('Quarterly Plan-pages-removed.pdf');
    expect(pagesRemovedFileName('report.v2.PDF')).toBe('report.v2-pages-removed.pdf');
    expect(pagesRemovedFileName('.pdf')).toBe('document-pages-removed.pdf');
  });
});
