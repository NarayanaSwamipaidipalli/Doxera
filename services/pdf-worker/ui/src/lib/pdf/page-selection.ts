/**
 * Page selection logic shared by the Split, Delete and Extract page tools. Page numbers are 1-based and always validated
 * against the real page count of the loaded document. Error wording matches the API and worker.
 */

export type SplitMode = 'extract' | 'every' | 'ranges';

export type SplitRequest =
  | { splitMode: 'extract'; pages: string }
  | { splitMode: 'every' }
  | { splitMode: 'ranges'; ranges: string[] };

export const MAX_PAGE_SPEC_LENGTH = 4000;
export const MAX_RANGE_GROUPS = 100;

export interface SpecResult {
  /** Sorted, unique, 1-based page numbers (empty when invalid). */
  pages: number[];
  error: string | null;
}

const RANGE = /^(\d+)\s*-\s*(\d+)$/;
const NUMBER = /^\d+$/;

export function parsePageSpec(input: string, pageCount: number): SpecResult {
  const fail = (error: string): SpecResult => ({ pages: [], error });
  if (input.length > MAX_PAGE_SPEC_LENGTH) return fail('The page selection is too long.');
  const seen = new Set<number>();
  for (const raw of input.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    if (token.startsWith('-') || /^\d+\s*-\s*-/.test(token)) return fail(`Page numbers must be positive (found "${token.slice(0, 40)}").`);
    let start: number;
    let end: number;
    const range = RANGE.exec(token);
    if (range) {
      start = Number(range[1]);
      end = Number(range[2]);
    } else if (NUMBER.test(token)) {
      start = end = Number(token);
    } else {
      return fail(`Could not understand "${token.slice(0, 40)}". Use page numbers like 1-3, 5.`);
    }
    if (start === 0 || end === 0) return fail('Page numbers start at 1 (found 0).');
    if (start > end) return fail(`The range "${start}-${end}" runs backwards. Write it as ${end}-${start}.`);
    if (end > pageCount) {
      return fail(`Page ${end} is beyond the end of this document (${pageCount} page${pageCount === 1 ? '' : 's'}).`);
    }
    for (let page = start; page <= end; page++) {
      if (seen.has(page)) return fail(`Page ${page} is selected more than once.`);
      seen.add(page);
    }
  }
  if (!seen.size) return fail('Select at least one page.');
  return { pages: Array.from(seen).sort((a, b) => a - b), error: null };
}

/** [1, 2, 3, 5, 8, 9] -> "1-3, 5, 8-9" */
export function formatPageSpec(pages: Iterable<number>): string {
  const sorted = Array.from(new Set(Array.from(pages))).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return parts.join(', ');
}

export function togglePage(selected: ReadonlySet<number>, page: number): Set<number> {
  const next = new Set(selected);
  if (next.has(page)) next.delete(page);
  else next.add(page);
  return next;
}

/** Shift-click / start-end selection: adds every page between `from` and `to` (inclusive, either order). */
export function selectRange(selected: ReadonlySet<number>, from: number, to: number, pageCount: number): Set<number> {
  const next = new Set(selected);
  const lo = Math.max(1, Math.min(from, to));
  const hi = Math.min(pageCount, Math.max(from, to));
  for (let page = lo; page <= hi; page++) next.add(page);
  return next;
}

export function allPages(pageCount: number): Set<number> {
  return new Set(Array.from({ length: pageCount }, (_, i) => i + 1));
}

/** Evenly sized groups: chunkRanges(12, 5) -> ["1-5", "6-10", "11-12"] */
export function chunkRanges(pageCount: number, size: number): string[] {
  const step = Math.max(1, Math.floor(size));
  const groups: string[] = [];
  for (let start = 1; start <= pageCount; start += step) {
    const end = Math.min(pageCount, start + step - 1);
    groups.push(start === end ? `${start}` : `${start}-${end}`);
  }
  return groups;
}

export interface GroupsResult {
  results: SpecResult[];
  error: string | null;
}

export interface GroupLabels {
  /** Prefix for per-item errors: "Range 2: …". */
  item: string;
  empty: string;
  /** Plural noun for the limit message: "Use at most 100 ranges." */
  plural: string;
}
const RANGE_LABELS: GroupLabels = { item: 'Range', empty: 'Add at least one page range.', plural: 'ranges' };

export function validateRangeGroups(groups: string[], pageCount: number, labels: GroupLabels = RANGE_LABELS): GroupsResult {
  const results = groups.map((group) => parsePageSpec(group, pageCount));
  if (!groups.length) return { results, error: labels.empty };
  if (groups.length > MAX_RANGE_GROUPS) return { results, error: `Use at most ${MAX_RANGE_GROUPS} ${labels.plural}.` };
  const firstBad = results.findIndex((r) => r.error);
  return { results, error: firstBad >= 0 ? `${labels.item} ${firstBad + 1}: ${results[firstBad].error}` : null };
}

/**
 * True while the user is still typing a range ("1-3, 8-"): the field should not flag an error or
 * change the selection yet. The full validation runs again when the field loses focus.
 */
export function isIncompleteSpec(input: string): boolean {
  return /\d\s*-\s*$/.test(input);
}

export interface SplitPlan {
  request: SplitRequest | null;
  error: string | null;
  /** Number of output PDFs, and whether they are delivered as a ZIP. */
  outputs: number;
  zipped: boolean;
}

/** Builds the API request for the chosen mode, or explains why it cannot run yet. */
export function buildSplitPlan(mode: SplitMode, pageCount: number, selected: ReadonlySet<number>, groups: string[]): SplitPlan {
  if (pageCount < 1) return { request: null, error: 'The document is still loading.', outputs: 0, zipped: false };
  if (mode === 'every') {
    return { request: { splitMode: 'every' }, error: null, outputs: pageCount, zipped: pageCount > 1 };
  }
  if (mode === 'extract') {
    const pages = Array.from(selected).filter((p) => p >= 1 && p <= pageCount);
    if (!pages.length) return { request: null, error: 'Select at least one page.', outputs: 0, zipped: false };
    return { request: { splitMode: 'extract', pages: formatPageSpec(pages) }, error: null, outputs: 1, zipped: false };
  }
  const cleaned = groups.map((g) => g.trim());
  const { results, error } = validateRangeGroups(cleaned, pageCount);
  if (error) return { request: null, error, outputs: 0, zipped: false };
  return {
    request: { splitMode: 'ranges', ranges: results.map((r) => formatPageSpec(r.pages)) },
    error: null,
    outputs: cleaned.length,
    zipped: cleaned.length > 1,
  };
}
