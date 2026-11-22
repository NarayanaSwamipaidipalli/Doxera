import { describe, expect, it } from 'vitest';
import { changeLabel, filterDifferences, type PdfDifference } from '../compare';

describe('Comparison change navigation', () => {
  const differences = ['added', 'removed', 'modified', 'visual', 'page_added', 'page_removed', 'page_moved'].map((type, i) => ({ id: i + 1, type })) as PdfDifference[];
  it('keeps structural changes in the full list and filters text and visual categories accurately', () => {
    expect(filterDifferences(differences, 'all')).toHaveLength(7);
    expect(filterDifferences(differences, 'text').map(d => d.type)).toEqual(['added', 'removed', 'modified']);
    expect(filterDifferences(differences, 'visual').map(d => d.type)).toEqual(['visual']);
    expect(differences.every(d => Boolean(changeLabel(d.type)))).toBe(true);
  });
});
