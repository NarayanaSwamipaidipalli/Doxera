/**
 * Redact PDF: selection geometry and request building.
 *
 * Areas are kept in points on the page as displayed (top-left origin, after /Rotate and the crop box), which is
 * exactly what pdf.js's viewport shows at scale 1 and what the worker expects
 * (services/pdf-worker/app/processors/redact_tools.py). Screen pixels / zoom = points, so zoom never changes them.
 */
export interface RedactionArea { id: string; page: number; x: number; y: number; width: number; height: number }
export interface RedactRequest { redactions: Omit<RedactionArea, 'id'>[]; terms: string[] }

export const MIN_AREA_POINTS = 2;
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** A drag on the page canvas (CSS pixels, any direction) -> an area in points, clamped to the page. */
export function dragToArea(
  start: { x: number; y: number }, end: { x: number; y: number }, zoom: number,
  page: { number: number; width: number; height: number }, id: string,
): RedactionArea | null {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x0 = clamp(Math.min(start.x, end.x) / zoom, page.width);
  const y0 = clamp(Math.min(start.y, end.y) / zoom, page.height);
  const x1 = clamp(Math.max(start.x, end.x) / zoom, page.width);
  const y1 = clamp(Math.max(start.y, end.y) / zoom, page.height);
  if (x1 - x0 < MIN_AREA_POINTS || y1 - y0 < MIN_AREA_POINTS) return null;
  return { id, page: page.number, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Where an area is drawn on screen at a zoom level (CSS pixels). */
export function areaToScreen(area: Pick<RedactionArea, 'x' | 'y' | 'width' | 'height'>, zoom: number) {
  return { left: area.x * zoom, top: area.y * zoom, width: area.width * zoom, height: area.height * zoom };
}

export interface TextBox { text: string; x: number; y: number; width: number; height: number }

/** Text runs (displayed-page points) that an area touches; the worker removes every word they contain. */
export function textInArea(boxes: readonly TextBox[], area: Pick<RedactionArea, 'x' | 'y' | 'width' | 'height'>): string {
  return boxes
    .filter((b) => b.text.trim() && b.x < area.x + area.width && b.x + b.width > area.x && b.y < area.y + area.height && b.y + b.height > area.y)
    .map((b) => b.text.trim())
    .join(' ');
}

/** Whole-word, case-insensitive matches of a term in a page's text (same rule as the worker). */
export function countWholeWordMatches(pageText: string, term: string): number {
  const words = term.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return 0;
  const pattern = new RegExp(`(^|\\s)${words.join('\\s+')}(?=[.,;:!?)\\]]*(\\s|$))`, 'gi');
  return (pageText.match(pattern) || []).length;
}

export function buildRedactRequest(areas: readonly RedactionArea[], terms: readonly string[]): RedactRequest {
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    redactions: areas.map(({ page, x, y, width, height }) => ({ page, x: round(x), y: round(y), width: round(width), height: round(height) })),
    terms: terms.map((t) => t.trim()).filter(Boolean),
  };
}

/** "Contract.pdf" -> "Contract-redacted.pdf". */
export function redactedFileName(name: string): string {
  return `${name.trim().replace(/\.pdf$/i, '') || 'document'}-redacted.pdf`;
}
