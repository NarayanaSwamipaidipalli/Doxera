import { formatPageSpec, validateRangeGroups } from './page-selection';

/**
 * Extract Pages request contract (1-based page numbers). The API checks the syntax before queueing
 * and the worker re-validates every page against the real document; without `extractMode` the
 * backend keeps its legacy lenient behaviour for older clients.
 */
export type ExtractMode = 'single' | 'separate' | 'groups';

export type ExtractRequest =
  | { extractMode: 'single' | 'separate'; pages: string }
  | { extractMode: 'groups'; groups: string[] };

export interface ExtractPlan {
  request: ExtractRequest | null;
  error: string | null;
  /** Number of output PDFs, and whether they are delivered together as a ZIP. */
  outputs: number;
  zipped: boolean;
  /** Pages in the selection (single/separate modes). */
  pageTotal: number;
}

export const GROUP_LABELS = { item: 'Group', empty: 'Add at least one page group.', plural: 'groups' };

export function buildExtractPlan(
  mode: ExtractMode,
  pageCount: number,
  selected: Iterable<number>,
  groups: string[],
  inputError: string | null = null,
): ExtractPlan {
  const fail = (error: string): ExtractPlan => ({ request: null, error, outputs: 0, zipped: false, pageTotal: 0 });
  if (!Number.isInteger(pageCount) || pageCount < 1) return fail('The document has not finished loading.');
  if (mode === 'groups') {
    const cleaned = groups.map((g) => g.trim());
    const { results, error } = validateRangeGroups(cleaned, pageCount, GROUP_LABELS);
    if (error) return fail(error);
    return {
      request: { extractMode: 'groups', groups: results.map((r) => formatPageSpec(r.pages)) },
      error: null,
      outputs: cleaned.length,
      zipped: cleaned.length > 1,
      pageTotal: 0,
    };
  }
  if (inputError) return fail(inputError);
  const pages = Array.from(new Set(Array.from(selected))).sort((a, b) => a - b);
  const outOfRange = pages.find((page) => !Number.isInteger(page) || page < 1 || page > pageCount);
  if (outOfRange !== undefined) {
    return fail(`Page ${outOfRange} is beyond the end of this document (${pageCount} page${pageCount === 1 ? '' : 's'}).`);
  }
  if (!pages.length) return fail('Select at least one page.');
  const outputs = mode === 'single' ? 1 : pages.length;
  return { request: { extractMode: mode, pages: formatPageSpec(pages) }, error: null, outputs, zipped: outputs > 1, pageTotal: pages.length };
}

/**
 * Download name for a finished extraction:
 *   ZIP                         → "Report-extracted-pages.zip"
 *   one PDF (single / groups)   → "Report-extracted-pages.pdf"
 *   one PDF (separate, 1 page)  → "Report-page-007.pdf"
 */
export function extractedFileName(originalName: string, request: ExtractRequest | null, ext: string): string {
  const base = originalName.replace(/\.[^/.]+$/, '').trim() || 'document';
  if (ext === 'pdf' && request?.extractMode === 'separate' && /^\d+$/.test(request.pages)) {
    return `${base}-page-${request.pages.padStart(3, '0')}.pdf`;
  }
  return `${base}-extracted-pages.${ext}`;
}
