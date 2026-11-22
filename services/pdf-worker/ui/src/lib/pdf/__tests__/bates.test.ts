import { describe, expect, it } from 'vitest';
import { batesFileName, batesLabel, batesLayout, DEFAULT_BATES, textWidth, validateBates } from '../bates';

describe('Bates numbering helpers', () => {
  it('measures text exactly like the worker (PyMuPDF Helvetica at 10 pt)', () => {
    expect(textWidth('DOX-000001', 10)).toBeCloseTo(58.36, 2);
    expect(textWidth('ACME_00000120-C', 10)).toBeCloseTo(89.48, 2);
    expect(textWidth('Wij [{|}] ~@ g', 10)).toBeCloseTo(58.61, 2);
    expect(textWidth(Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''), 10)).toBeCloseTo(500.58, 2);
  });

  it('builds labels with prefix, padding, increment and suffix', () => {
    expect([0, 1, 4].map((i) => batesLabel(DEFAULT_BATES, i))).toEqual(['DOX-000001', 'DOX-000002', 'DOX-000005']);
    expect(batesLabel({ prefix: 'ACME_', suffix: '-C', startNumber: 120, padding: 8, increment: 5 }, 3)).toBe('ACME_00000135-C');
    expect(batesLabel({ ...DEFAULT_BATES, startNumber: 999, padding: 3 }, 1)).toBe('DOX-1000');
  });

  it('places the box like the worker, shrinking long labels to fit', () => {
    const br = batesLayout('DOX-000001', 10, 595, 842, 'bottom-right', 24);
    expect(br.x + br.width).toBeCloseTo(571, 5);
    expect(br.y + br.height).toBeCloseTo(818, 5);
    const tc = batesLayout('DOX-000001', 10, 595, 842, 'top-center', 24);
    expect(tc.y).toBe(24);
    expect(tc.x + tc.width / 2).toBeCloseTo(297.5, 5);
    const long = batesLayout('ACME-LITIGATION-2026-PRODUCTION-000001', 20, 300, 400, 'bottom-left', 20);
    expect(long.fontSize).toBeLessThan(20);
    expect(long.x + long.width).toBeLessThanOrEqual(280.0001);
  });

  it('validates settings and page selections with the same messages as the API', () => {
    expect(validateBates(DEFAULT_BATES, 5)).toEqual({ errors: {}, pages: [1, 2, 3, 4, 5] });
    expect(validateBates({ ...DEFAULT_BATES, pages: '2-3, 5' }, 5).pages).toEqual([2, 3, 5]);
    const bad = validateBates({ ...DEFAULT_BATES, prefix: '€', padding: 13, increment: 0, fontSize: 2, color: 'red', pages: '7' }, 5).errors;
    expect(bad).toEqual({
      prefix: 'The prefix can use letters, digits, spaces and common symbols only.',
      padding: 'Padding must be between 0 and 12.',
      increment: 'The increment must be between 1 and 1,000.',
      fontSize: 'Font size must be between 6 and 36.',
      color: 'The colour must be a hex value such as #000000.',
      pages: expect.stringMatching(/beyond the end/),
    });
    expect(validateBates({ ...DEFAULT_BATES, startNumber: 1.5 }, 2).errors.startNumber).toBe('The starting number must be a whole number.');
  });

  it('names the download', () => {
    expect(batesFileName('Exhibit A.pdf')).toBe('Exhibit A-bates-numbered.pdf');
    expect(batesFileName('scan.PDF')).toBe('scan-bates-numbered.pdf');
  });
});
