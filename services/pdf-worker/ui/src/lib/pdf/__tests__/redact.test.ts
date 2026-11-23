import { describe, expect, it } from 'vitest';
import { areaToScreen, buildRedactRequest, countWholeWordMatches, dragToArea, redactedFileName, textInArea } from '../redact';

const page = { number: 2, width: 595, height: 842 };

describe('Redact PDF selection geometry', () => {
  it('converts drags to page points independently of zoom, in any direction', () => {
    for (const zoom of [0.5, 1, 1.5, 2]) {
      const area = dragToArea({ x: 300 * zoom, y: 220 * zoom }, { x: 100 * zoom, y: 200 * zoom }, zoom, page, 'a');
      expect(area).toEqual({ id: 'a', page: 2, x: 100, y: 200, width: 200, height: 20 });
      expect(areaToScreen(area!, zoom)).toEqual({ left: 100 * zoom, top: 200 * zoom, width: 200 * zoom, height: 20 * zoom });
    }
  });

  it('clamps to the page and ignores accidental clicks', () => {
    expect(dragToArea({ x: -50, y: -10 }, { x: 40, y: 30 }, 1, page, 'b')).toMatchObject({ x: 0, y: 0, width: 40, height: 30 });
    expect(dragToArea({ x: 580, y: 830 }, { x: 900, y: 900 }, 1, page, 'c')).toMatchObject({ x: 580, y: 830, width: 15, height: 12 });
    expect(dragToArea({ x: 10, y: 10 }, { x: 11, y: 40 }, 1, page, 'd')).toBeNull();
  });

  it('shows the text an area touches', () => {
    const boxes = [
      { text: 'Customer name', x: 45, y: 140, width: 60, height: 8 },
      { text: 'Maya Testerson', x: 45, y: 152, width: 85, height: 11 },
      { text: 'REDACT', x: 395, y: 152, width: 30, height: 8 },
    ];
    expect(textInArea(boxes, { x: 44, y: 151, width: 90, height: 13 })).toBe('Maya Testerson');
    expect(textInArea(boxes, { x: 0, y: 0, width: 10, height: 10 })).toBe('');
  });

  it('counts whole-word matches like the worker (no matches inside longer identifiers)', () => {
    const text = 'Ref INV-SECRET-8274 and SECRET note. Phone +1 202-555-0147, email maya@example.com.';
    expect(countWholeWordMatches(text, 'SECRET')).toBe(1);
    expect(countWholeWordMatches(text, 'secret')).toBe(1);
    expect(countWholeWordMatches(text, '+1 202-555-0147')).toBe(1);
    expect(countWholeWordMatches(text, 'maya@example.com')).toBe(1);
    expect(countWholeWordMatches(text, 'INV')).toBe(0);
  });

  it('builds the request and names the download', () => {
    expect(buildRedactRequest([{ id: 'a', page: 1, x: 10.123, y: 5, width: 20.456, height: 3 }], [' Maya ', ''])).toEqual({
      redactions: [{ page: 1, x: 10.12, y: 5, width: 20.46, height: 3 }], terms: ['Maya'],
    });
    expect(redactedFileName('Contract.pdf')).toBe('Contract-redacted.pdf');
  });
});
