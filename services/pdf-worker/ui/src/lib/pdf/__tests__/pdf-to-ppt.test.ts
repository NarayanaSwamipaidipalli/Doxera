import { describe, expect, it } from 'vitest';
import { describePageSize, pptFileName, summarisePageSizes } from '../pdf-to-ppt';

describe('pdf-to-ppt helpers', () => {
  it('names the download after the original file', () => {
    expect(pptFileName('Board Deck.pdf')).toBe('Board Deck.pptx');
    expect(pptFileName('report.v2.PDF')).toBe('report.v2.pptx');
    expect(pptFileName('.pdf')).toBe('document.pptx');
  });

  it('picks the most common page size first (first page wins ties), like the converter', () => {
    const a4 = { width: 595.3, height: 841.9 };
    const landscape = { width: 841.9, height: 595.3 };
    expect(summarisePageSizes([landscape, a4, a4])).toEqual({
      sizes: [{ width: 595, height: 842, count: 2 }, { width: 842, height: 595, count: 1 }],
      mixed: true,
    });
    expect(summarisePageSizes([landscape, a4]).sizes[0]).toEqual({ width: 842, height: 595, count: 1 });
    expect(summarisePageSizes([a4, a4]).mixed).toBe(false);
  });

  it('describes common page sizes', () => {
    expect(describePageSize(595, 842)).toBe('A4 portrait');
    expect(describePageSize(842, 595)).toBe('A4 landscape');
    expect(describePageSize(612, 792)).toBe('Letter portrait');
    expect(describePageSize(960, 540)).toBe('16:9 slide');
    expect(describePageSize(1000, 700)).toBe('13.9 × 9.7 in');
  });
});
