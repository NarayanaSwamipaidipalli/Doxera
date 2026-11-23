import { formatPageSpec } from './page-selection';

/**
 * Delete Pages request sent with a `delete-pages` job. `strictPages` opts into strict 1-based
 * validation (re-checked by the API and by the worker against the real page count); without it the
 * backend keeps its legacy lenient behaviour for older clients. `deletePages` mirrors the value so
 * the legacy field can never disagree with what the user confirmed.
 */
export interface DeletePagesRequest {
  strictPages: true;
  pagesToDelete: string;
  deletePages: string;
}

export interface DeletePlan {
  request: DeletePagesRequest | null;
  error: string | null;
  /** 1-based pages that will be removed, ascending. */
  deleting: number[];
  /** 1-based pages that will be kept, in their original order. */
  remaining: number[];
}

export const KEEP_ONE_PAGE_ERROR = "You can't delete every page. Keep at least one page.";
export const NOTHING_SELECTED_ERROR = 'Select at least one page to delete.';

/** Validate a deletion against the real page count. Never drops or adjusts pages silently. */
export function buildDeletePlan(pageCount: number, selected: Iterable<number>, inputError: string | null = null): DeletePlan {
  const deleting = Array.from(new Set(Array.from(selected))).sort((a, b) => a - b);
  const fail = (error: string): DeletePlan => ({ request: null, error, deleting, remaining: [] });
  if (!Number.isInteger(pageCount) || pageCount < 1) return fail('The document has not finished loading.');
  if (inputError) return fail(inputError);
  const outOfRange = deleting.find((page) => !Number.isInteger(page) || page < 1 || page > pageCount);
  if (outOfRange !== undefined) {
    return fail(`Page ${outOfRange} is beyond the end of this document (${pageCount} page${pageCount === 1 ? '' : 's'}).`);
  }
  if (deleting.length === 0) return fail(NOTHING_SELECTED_ERROR);
  if (deleting.length >= pageCount) return fail(KEEP_ONE_PAGE_ERROR);
  const removed = new Set(deleting);
  const remaining = Array.from({ length: pageCount }, (_, i) => i + 1).filter((page) => !removed.has(page));
  const spec = formatPageSpec(deleting);
  return { request: { strictPages: true, pagesToDelete: spec, deletePages: spec }, error: null, deleting, remaining };
}

/** Every page except the first, the largest selection that still leaves a valid PDF. */
export function allExceptFirst(pageCount: number): Set<number> {
  return new Set(Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => i + 2));
}

/** Swap marked and unmarked pages, e.g. to pick the pages to keep and then delete the rest. */
export function invertSelection(selected: ReadonlySet<number>, pageCount: number): Set<number> {
  const next = new Set<number>();
  for (let page = 1; page <= pageCount; page++) if (!selected.has(page)) next.add(page);
  return next;
}

/** "Quarterly Plan.pdf" → "Quarterly Plan-pages-removed.pdf". */
export function pagesRemovedFileName(originalName: string): string {
  const base = originalName.replace(/\.[^/.]+$/, '').trim() || 'document';
  return `${base}-pages-removed.pdf`;
}
