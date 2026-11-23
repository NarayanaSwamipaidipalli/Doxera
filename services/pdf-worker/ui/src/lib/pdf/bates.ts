/**
 * Bates numbering: labels, layout and validation shared by the preview and the request.
 * Mirrors the worker (services/pdf-worker/app/processors/bates_tools.py) so the preview shows what is stamped:
 * same Helvetica widths, same box (text + 0.35 x size padding), same margins and the same shrink-to-fit rule.
 */
import { parsePageSpec } from './page-selection';

export const BATES_POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type BatesPosition = (typeof BATES_POSITIONS)[number];

export interface BatesRequest {
  prefix: string;
  suffix: string;
  startNumber: number;
  padding: number;
  increment: number;
  /** Empty = every page. */
  pages: string;
  position: BatesPosition;
  fontSize: number;
  color: string;
  margin: number;
  background: boolean;
}

export const DEFAULT_BATES: BatesRequest = {
  prefix: 'DOX-', suffix: '', startNumber: 1, padding: 6, increment: 1, pages: '',
  position: 'bottom-right', fontSize: 10, color: '#000000', margin: 24, background: false,
};

export const BATES_LIMITS = {
  affix: 40, start: [0, 999_999_999_999], padding: [0, 12], increment: [1, 1000], fontSize: [6, 36], margin: [0, 144],
} as const;

// Helvetica advance widths (1/1000 em) for characters 32-126, as used by the worker's PDF font.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722,
  778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556,
  278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260,
  334, 584,
];

export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
  }
  return (units * size) / 1000;
}

export function batesLabel(request: Pick<BatesRequest, 'prefix' | 'suffix' | 'startNumber' | 'padding' | 'increment'>, index: number): string {
  const number = String(request.startNumber + index * request.increment);
  return `${request.prefix}${number.padStart(request.padding, '0')}${request.suffix}`;
}

export interface BatesBox { x: number; y: number; width: number; height: number; fontSize: number; padding: number }

/** The label box on a page as displayed (points), exactly as the worker places it. */
export function batesLayout(text: string, fontSize: number, pageWidth: number, pageHeight: number, position: BatesPosition, margin: number): BatesBox {
  let size = fontSize;
  const available = Math.max(pageWidth - 2 * margin, 1);
  const natural = textWidth(text, size) + 2 * 0.35 * size;
  if (natural > available) size = Math.max(4, (size * available) / natural);
  const padding = 0.35 * size;
  const width = textWidth(text, size) + 2 * padding;
  const height = size + 2 * padding;
  const [vertical, horizontal] = position.split('-');
  const x = horizontal === 'left' ? margin : horizontal === 'right' ? pageWidth - margin - width : (pageWidth - width) / 2;
  const y = vertical === 'top' ? margin : pageHeight - margin - height;
  return { x, y, width, height, fontSize: size, padding };
}

const PRINTABLE = /^[\x20-\x7e]*$/;

function inRange(value: number, [min, max]: readonly [number, number], label: string, whole = true): string | null {
  if (!Number.isFinite(value) || (whole && !Number.isInteger(value))) return `${label} must be a ${whole ? 'whole ' : ''}number.`;
  return value < min || value > max ? `${label} must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.` : null;
}

export type BatesField = 'prefix' | 'suffix' | 'startNumber' | 'padding' | 'increment' | 'pages' | 'fontSize' | 'margin' | 'color';

/** Problems per field (same wording as the API and worker), and the 1-based pages that will be numbered. */
export function validateBates(request: BatesRequest, pageCount: number): { errors: Partial<Record<BatesField, string>>; pages: number[] } {
  const errors: Partial<Record<BatesField, string>> = {};
  for (const [field, label] of [['prefix', 'prefix'], ['suffix', 'suffix']] as const) {
    const value = request[field];
    if (!PRINTABLE.test(value)) errors[field] = `The ${label} can use letters, digits, spaces and common symbols only.`;
    else if (value.length > BATES_LIMITS.affix) errors[field] = `The ${label} can be at most ${BATES_LIMITS.affix} characters.`;
  }
  const numeric: Array<[BatesField, number, readonly [number, number], string, boolean]> = [
    ['startNumber', request.startNumber, BATES_LIMITS.start, 'The starting number', true],
    ['padding', request.padding, BATES_LIMITS.padding, 'Padding', true],
    ['increment', request.increment, BATES_LIMITS.increment, 'The increment', true],
    ['fontSize', request.fontSize, BATES_LIMITS.fontSize, 'Font size', false],
    ['margin', request.margin, BATES_LIMITS.margin, 'The margin', false],
  ];
  for (const [field, value, range, label, whole] of numeric) {
    const problem = inRange(value, range, label, whole);
    if (problem) errors[field] = problem;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(request.color)) errors.color = 'The colour must be a hex value such as #000000.';
  let pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  if (request.pages.trim()) {
    const spec = parsePageSpec(request.pages, pageCount);
    if (spec.error) errors.pages = spec.error;
    pages = spec.pages;
  }
  if (!errors.startNumber && !errors.increment && pages.length
    && request.startNumber + (pages.length - 1) * request.increment > BATES_LIMITS.start[1]) {
    errors.startNumber = 'The Bates numbers would go past 999,999,999,999. Use a smaller start or increment.';
  }
  return { errors, pages };
}

/** "Exhibit A.pdf" -> "Exhibit A-bates-numbered.pdf". */
export function batesFileName(name: string): string {
  return `${name.trim().replace(/\.pdf$/i, '') || 'document'}-bates-numbered.pdf`;
}
