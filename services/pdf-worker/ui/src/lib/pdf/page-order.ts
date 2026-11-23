/**
 * Page-order logic for the Reorder PDF tool. An order is an array of 1-based ORIGINAL page numbers
 * in their NEW positions: [5, 1, 2, 3, 4] means original page 5 is now first. Every function
 * returns a new array and keeps the order a complete permutation (nothing dropped or duplicated).
 */

export interface ReorderRequest {
  /** 1-based original page numbers in output order; a complete permutation of 1..pageCount. */
  pageOrder: number[];
}

export const MAX_ORDER_INPUT_LENGTH = 20_000;

export function originalOrder(pageCount: number): number[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1);
}

export function isOriginalOrder(order: readonly number[]): boolean {
  return order.every((page, index) => page === index + 1);
}

export function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((page, index) => page === b[index]);
}

// ------------------------------------------------------------------ text <-> order

export type OrderParse =
  | { status: 'valid'; order: number[] }
  /** Well-formed so far but not every page is placed yet (or the user is mid-range). */
  | { status: 'incomplete'; missing: number[]; message: string }
  | { status: 'invalid'; message: string };

const TOKEN_RANGE = /^(\d+)\s*-\s*(\d+)$/;
const TOKEN_NUMBER = /^\d+$/;

function listPages(pages: number[]): string {
  const shown = pages.slice(0, 8).join(', ');
  return pages.length > 8 ? `${shown} and ${pages.length - 8} more` : shown;
}

export function missingMessage(missing: number[]): string {
  return missing.length === 1
    ? `Page ${missing[0]} is missing. Every page must appear exactly once.`
    : `Pages ${listPages(missing)} are missing. Every page must appear exactly once.`;
}

/**
 * Parse "Custom Page Order" text such as "3, 1, 5, 2, 4". Ranges are allowed in either direction:
 * "5, 1-4" or "10-1" (reversed). Validation uses the real page count.
 */
export function parsePageOrder(input: string, pageCount: number): OrderParse {
  if (input.length > MAX_ORDER_INPUT_LENGTH) return { status: 'invalid', message: 'The page order is too long.' };
  const order: number[] = [];
  const seen = new Set<number>();
  const tokens = input.split(',');
  let typingRange = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) continue;
    if (i === tokens.length - 1 && /^\d+\s*-\s*$/.test(token)) { typingRange = true; continue; }
    let from: number;
    let to: number;
    const range = TOKEN_RANGE.exec(token);
    if (range) { from = Number(range[1]); to = Number(range[2]); }
    else if (TOKEN_NUMBER.test(token)) { from = to = Number(token); }
    else if (/^-/.test(token) || /^\d+\s*-\s*-/.test(token)) return { status: 'invalid', message: `Page numbers must be positive (found "${token.slice(0, 40)}").` };
    else return { status: 'invalid', message: `Could not understand "${token.slice(0, 40)}". Use page numbers like 3, 1, 5-2.` };
    if (from === 0 || to === 0) return { status: 'invalid', message: 'Page numbers start at 1 (found 0).' };
    const step = from <= to ? 1 : -1;
    for (let page = from; ; page += step) {
      if (page > pageCount) {
        return { status: 'invalid', message: `Page ${page} is beyond the end of this document (${pageCount} page${pageCount === 1 ? '' : 's'}).` };
      }
      if (seen.has(page)) return { status: 'invalid', message: `Page ${page} appears more than once.` };
      seen.add(page);
      order.push(page);
      if (page === to) break;
    }
  }
  const missing = originalOrder(pageCount).filter((page) => !seen.has(page));
  if (typingRange || missing.length) {
    return {
      status: 'incomplete',
      missing,
      message: !order.length ? 'Enter the new page order.' : missing.length ? missingMessage(missing) : 'Finish typing the page range.',
    };
  }
  return { status: 'valid', order };
}

/** [5, 1, 2, 3, 4] → "5, 1-4"; [10, 9, …, 1] → "10-1". Round-trips with parsePageOrder. */
export function formatPageOrder(order: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < order.length; ) {
    let j = i;
    const step = order[i + 1] - order[i];
    if (step === 1 || step === -1) while (j + 1 < order.length && order[j + 1] - order[j] === step) j++;
    // Ascending runs of 2+ and descending runs of 3+ collapse ("2, 1" stays readable).
    if (j > i && (step === 1 || j - i >= 2)) { parts.push(`${order[i]}-${order[j]}`); i = j + 1; }
    else { parts.push(String(order[i])); i += 1; }
  }
  return parts.join(', ');
}

// ------------------------------------------------------------------ moves (pages = original numbers)

function inOrder(order: readonly number[], pages: Iterable<number>): number[] {
  const set = new Set(pages);
  return order.filter((page) => set.has(page));
}

/** Remove `pages` and insert them, in their current relative order, at `index` of the remaining list. */
export function insertGroupAt(order: readonly number[], pages: Iterable<number>, index: number): number[] {
  const group = inOrder(order, pages);
  if (!group.length) return order.slice();
  const set = new Set(group);
  const rest = order.filter((page) => !set.has(page));
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), ...group, ...rest.slice(at)];
}

export const moveToStart = (order: readonly number[], pages: Iterable<number>) => insertGroupAt(order, pages, 0);
export const moveToEnd = (order: readonly number[], pages: Iterable<number>) => insertGroupAt(order, pages, order.length);

/** One step towards the start. A scattered selection is gathered just before its first page's slot. */
export function moveLeft(order: readonly number[], pages: Iterable<number>): number[] {
  const set = new Set(pages);
  const first = order.findIndex((page) => set.has(page));
  return first < 0 ? order.slice() : insertGroupAt(order, set, first - 1);
}

/** One step towards the end. A scattered selection is gathered just after the page following its first page. */
export function moveRight(order: readonly number[], pages: Iterable<number>): number[] {
  const set = new Set(pages);
  const first = order.findIndex((page) => set.has(page));
  return first < 0 ? order.slice() : insertGroupAt(order, set, first + 1);
}

export function reverseOrder(order: readonly number[]): number[] {
  return order.slice().reverse();
}

/**
 * Drag-and-drop result. `active` was dropped on `over` (both original page numbers); like a
 * sortable list, the dragged page takes `over`'s position. When `group` (the selection) contains
 * `active`, the whole group moves together and lands where `active` was dropped.
 */
export function dropPages(order: readonly number[], active: number, over: number, group: ReadonlySet<number> = new Set()): number[] {
  const from = order.indexOf(active);
  const to = order.indexOf(over);
  if (from < 0 || to < 0) return order.slice();
  const moved = order.slice();
  moved.splice(to, 0, ...moved.splice(from, 1));
  if (!group.has(active) || group.size < 2) return moved;
  const members = inOrder(order, group);
  const others = new Set(members.filter((page) => page !== active));
  const rest = moved.filter((page) => !others.has(page));
  const at = rest.indexOf(active);
  rest.splice(at, 1, ...members);
  return rest;
}

/** Pages between two original page numbers in the CURRENT visual order (for Shift-click). */
export function pagesBetween(order: readonly number[], a: number, b: number): number[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Number of pages whose position changed. */
export function movedCount(order: readonly number[]): number {
  return order.reduce((n, page, index) => n + (page === index + 1 ? 0 : 1), 0);
}

// ------------------------------------------------------------------ undo / redo

export interface OrderHistory {
  past: number[][];
  present: number[];
  future: number[][];
}

export const HISTORY_LIMIT = 200;

export function initHistory(order: number[]): OrderHistory {
  return { past: [], present: order, future: [] };
}

/** Record a new order. No-op when nothing changed, so repeated identical moves add no undo steps. */
export function pushOrder(history: OrderHistory, order: number[]): OrderHistory {
  if (sameOrder(history.present, order)) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: order, future: [] };
}

export function undoOrder(history: OrderHistory): OrderHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redoOrder(history: OrderHistory): OrderHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

/** "Quarterly Plan.pdf" → "Quarterly Plan-reordered.pdf". */
export function reorderedFileName(originalName: string): string {
  const base = originalName.replace(/\.[^/.]+$/, '').trim() || 'document';
  return `${base}-reordered.pdf`;
}
