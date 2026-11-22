import { describe, expect, it } from 'vitest';
import {
  allPages, buildSplitPlan, chunkRanges, formatPageSpec, parsePageSpec, selectRange, togglePage, validateRangeGroups,
} from '../page-selection';

describe('parsePageSpec', () => {
  it('parses pages and ranges into sorted unique page numbers', () => {
    expect(parsePageSpec('1-3, 5, 8-12', 12)).toEqual({ pages: [1, 2, 3, 5, 8, 9, 10, 11, 12], error: null });
    expect(parsePageSpec(' 9 ,2- 3,', 12)).toEqual({ pages: [2, 3, 9], error: null });
    expect(parsePageSpec('7', 7).pages).toEqual([7]);
  });

  it.each([
    ['0', 'Page numbers start at 1 (found 0).'],
    ['0-4', 'Page numbers start at 1 (found 0).'],
    ['-3', 'Page numbers must be positive (found "-3").'],
    ['2--5', 'Page numbers must be positive (found "2--5").'],
    ['13', 'Page 13 is beyond the end of this document (12 pages).'],
    ['10-20', 'Page 20 is beyond the end of this document (12 pages).'],
    ['6-2', 'The range "6-2" runs backwards. Write it as 2-6.'],
    ['1-4, 4', 'Page 4 is selected more than once.'],
    ['3, 3', 'Page 3 is selected more than once.'],
    ['two', 'Could not understand "two". Use page numbers like 1-3, 5.'],
    ['1.5', 'Could not understand "1.5". Use page numbers like 1-3, 5.'],
    ['', 'Select at least one page.'],
    [' , ', 'Select at least one page.'],
  ])('rejects %j with a clear message', (input, error) => {
    expect(parsePageSpec(input, 12)).toEqual({ pages: [], error });
  });

  it('uses singular wording for one-page documents', () => {
    expect(parsePageSpec('2', 1).error).toBe('Page 2 is beyond the end of this document (1 page).');
  });

  it('rejects oversized input', () => {
    expect(parsePageSpec('1,'.repeat(3000), 10).error).toBe('The page selection is too long.');
  });
});

describe('formatPageSpec', () => {
  it('collapses consecutive pages into ranges', () => {
    expect(formatPageSpec([5, 1, 2, 3, 8, 9, 10, 11, 12])).toBe('1-3, 5, 8-12');
    expect(formatPageSpec(new Set([4]))).toBe('4');
    expect(formatPageSpec([])).toBe('');
    expect(formatPageSpec([2, 2, 3])).toBe('2-3');
  });

  it('round-trips with parsePageSpec (input and thumbnails stay in sync)', () => {
    for (const spec of ['1-3, 5, 8-12', '2', '1-12', '1, 3, 5, 7']) {
      expect(formatPageSpec(parsePageSpec(spec, 12).pages)).toBe(spec);
    }
  });
});

describe('thumbnail selection', () => {
  it('selects and deselects a single page', () => {
    const one = togglePage(new Set(), 4);
    expect(Array.from(one)).toEqual([4]);
    expect(Array.from(togglePage(one, 4))).toEqual([]);
  });

  it('selects multiple pages without losing earlier ones', () => {
    let selected = togglePage(new Set(), 2);
    selected = togglePage(selected, 9);
    selected = togglePage(selected, 5);
    expect(formatPageSpec(selected)).toBe('2, 5, 9');
  });

  it('shift-click adds every page between the anchor and the target, in either direction', () => {
    const base = new Set([2]);
    expect(formatPageSpec(selectRange(base, 5, 8, 12))).toBe('2, 5-8');
    expect(formatPageSpec(selectRange(base, 8, 5, 12))).toBe('2, 5-8');
    expect(formatPageSpec(selectRange(new Set(), 10, 40, 12))).toBe('10-12');
  });

  it('selects all pages and returns new sets (no mutation)', () => {
    const base = new Set([1]);
    togglePage(base, 2);
    selectRange(base, 1, 5, 5);
    expect(Array.from(base)).toEqual([1]);
    expect(formatPageSpec(allPages(12))).toBe('1-12');
  });
});

describe('range groups', () => {
  it('chunks a document into even ranges', () => {
    expect(chunkRanges(12, 5)).toEqual(['1-5', '6-10', '11-12']);
    expect(chunkRanges(3, 1)).toEqual(['1', '2', '3']);
    expect(chunkRanges(4, 10)).toEqual(['1-4']);
  });

  it('reports the first invalid group by number', () => {
    expect(validateRangeGroups(['1-5', '6-10'], 12).error).toBeNull();
    expect(validateRangeGroups(['1-5', '6-14'], 12).error).toBe('Range 2: Page 14 is beyond the end of this document (12 pages).');
    expect(validateRangeGroups([], 12).error).toBe('Add at least one page range.');
    expect(validateRangeGroups(Array(101).fill('1'), 12).error).toBe('Use at most 100 ranges.');
  });
});

describe('buildSplitPlan', () => {
  it('extract mode sends the selection in normalized form', () => {
    expect(buildSplitPlan('extract', 12, new Set([3, 1, 2, 7]), [])).toEqual({
      request: { splitMode: 'extract', pages: '1-3, 7' }, error: null, outputs: 1, zipped: false,
    });
    expect(buildSplitPlan('extract', 12, new Set(), []).error).toBe('Select at least one page.');
  });

  it('every-page mode produces one PDF per page, zipped when more than one', () => {
    expect(buildSplitPlan('every', 12, new Set(), [])).toMatchObject({ request: { splitMode: 'every' }, outputs: 12, zipped: true });
    expect(buildSplitPlan('every', 1, new Set(), [])).toMatchObject({ outputs: 1, zipped: false });
  });

  it('range mode validates each group against the page count', () => {
    expect(buildSplitPlan('ranges', 15, new Set(), ['1-5', ' 6-10 ', '11-15'])).toEqual({
      request: { splitMode: 'ranges', ranges: ['1-5', '6-10', '11-15'] }, error: null, outputs: 3, zipped: true,
    });
    expect(buildSplitPlan('ranges', 15, new Set(), ['1-5', '']).error).toBe('Range 2: Select at least one page.');
    expect(buildSplitPlan('ranges', 15, new Set(), ['4-6']).zipped).toBe(false);
  });

  it('refuses to plan before the document has loaded', () => {
    expect(buildSplitPlan('every', 0, new Set(), []).request).toBeNull();
  });
});
