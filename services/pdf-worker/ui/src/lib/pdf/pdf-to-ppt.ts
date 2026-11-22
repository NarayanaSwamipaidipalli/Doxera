/**
 * PDF to PowerPoint request. `visual` (default) turns each page into a high-resolution picture slide that
 * looks exactly like the PDF but is not editable; `editable` rebuilds text boxes, tables, simple shapes
 * and images where possible and keeps anything else visible as a background picture.
 */
export type PptMode = 'visual' | 'editable';

export interface PptRequest {
  pptMode: PptMode;
}

export const PPT_MODES: readonly PptMode[] = ['visual', 'editable'];

/** "Board Deck.pdf" → "Board Deck.pptx". */
export function pptFileName(originalName: string): string {
  const base = originalName.replace(/\.[^/.]+$/, '').trim() || 'document';
  return `${base}.pptx`;
}

export interface PageSizeSummary {
  /** Distinct page sizes (points, rounded), most common first, with how many pages use each. */
  sizes: { width: number; height: number; count: number }[];
  mixed: boolean;
}

/** Group page sizes the way the converter does: the most common size becomes the slide size. */
export function summarisePageSizes(sizes: { width: number; height: number }[]): PageSizeSummary {
  const counts = new Map<string, { width: number; height: number; count: number; first: number }>();
  sizes.forEach(({ width, height }, index) => {
    const w = Math.round(width);
    const h = Math.round(height);
    const key = `${w}x${h}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { width: w, height: h, count: 1, first: index });
  });
  const ordered = Array.from(counts.values()).sort((a, b) => b.count - a.count || a.first - b.first);
  return { sizes: ordered.map(({ width, height, count }) => ({ width, height, count })), mixed: ordered.length > 1 };
}

const NAMED_SIZES: [string, number, number][] = [
  ['A4', 595, 842], ['Letter', 612, 792], ['Legal', 612, 1008], ['A3', 842, 1191], ['A5', 420, 595], ['16:9 slide', 540, 960], ['4:3 slide', 540, 720],
];

/** "A4 portrait", "16:9 slide", or "8.5 × 11 in" for other sizes. */
export function describePageSize(width: number, height: number): string {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const named = NAMED_SIZES.find(([, s, l]) => Math.abs(s - short) <= 3 && Math.abs(l - long) <= 3);
  if (named) return named[0].includes('slide') ? named[0] : `${named[0]} ${height >= width ? 'portrait' : 'landscape'}`;
  return `${(width / 72).toFixed(1)} × ${(height / 72).toFixed(1)} in`;
}
