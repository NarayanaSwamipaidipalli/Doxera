import { describe, expect, it } from 'vitest';
import { buildExtractPlan, extractedFileName } from '../extract-selection';
import { formatPageSpec, isIncompleteSpec, parsePageSpec, selectRange, togglePage, validateRangeGroups } from '../page-selection';

describe('buildExtractPlan', () => {
  it('Mode A: one PDF with the selected pages in document order', () => {
    expect(buildExtractPlan('single', 20, new Set([10, 2, 9, 5, 8]), [])).toEqual({
      request: { extractMode: 'single', pages: '2, 5, 8-10' }, error: null, outputs: 1, zipped: false, pageTotal: 5,
    });
    expect(buildExtractPlan('single', 20, [7], []).request).toEqual({ extractMode: 'single', pages: '7' });
  });

  it('Mode B: one PDF per selected page, zipped when more than one', () => {
    expect(buildExtractPlan('separate', 20, [2, 5, 6], [])).toMatchObject({
      request: { extractMode: 'separate', pages: '2, 5-6' }, outputs: 3, zipped: true,
    });
    expect(buildExtractPlan('separate', 20, [4], [])).toMatchObject({ outputs: 1, zipped: false });
  });

  it('Mode C: one PDF per group, validated against the page count', () => {
    expect(buildExtractPlan('groups', 20, [], ['1-5', ' 8-12 ', '15-18'])).toEqual({
      request: { extractMode: 'groups', groups: ['1-5', '8-12', '15-18'] }, error: null, outputs: 3, zipped: true, pageTotal: 0,
    });
    expect(buildExtractPlan('groups', 20, [], ['1-5', '18-25']).error).toBe('Group 2: Page 25 is beyond the end of this document (20 pages).');
    expect(buildExtractPlan('groups', 20, [], ['1-5', '']).error).toBe('Group 2: Select at least one page.');
    expect(buildExtractPlan('groups', 20, [], []).error).toBe('Add at least one page group.');
    expect(buildExtractPlan('groups', 20, [], ['4-6']).zipped).toBe(false);
  });

  it('requires a selection and never drops out-of-range pages silently', () => {
    expect(buildExtractPlan('single', 20, [], []).error).toBe('Select at least one page.');
    expect(buildExtractPlan('separate', 20, [3, 21], [])).toMatchObject({
      request: null, error: 'Page 21 is beyond the end of this document (20 pages).',
    });
    expect(buildExtractPlan('single', 20, [0], []).request).toBeNull();
  });

  it('is blocked while the typed field is invalid or unfinished', () => {
    expect(buildExtractPlan('single', 20, [2], [], 'Finish typing the page range.')).toMatchObject({
      request: null, error: 'Finish typing the page range.',
    });
    // Group mode does not depend on the typed selection field.
    expect(buildExtractPlan('groups', 20, [], ['1-2'], 'Finish typing the page range.').request).not.toBeNull();
  });

  it('refuses to plan before the document has loaded', () => {
    expect(buildExtractPlan('single', 0, [1], []).request).toBeNull();
  });
});

describe('selection helpers used by Extract', () => {
  it('single, multiple and range selection stay in sync with the typed field', () => {
    let selected = togglePage(new Set(), 3);
    expect(formatPageSpec(selected)).toBe('3');
    selected = togglePage(selected, 7);
    selected = selectRange(selected, 10, 12, 20);
    expect(formatPageSpec(selected)).toBe('3, 7, 10-12');
    const typed = parsePageSpec('1-3, 8, 10-12', 20);
    expect(formatPageSpec(typed.pages)).toBe('1-3, 8, 10-12');
  });

  it('recognises a range that is still being typed', () => {
    expect(isIncompleteSpec('1-3, 8-')).toBe(true);
    expect(isIncompleteSpec('8 - ')).toBe(true);
    expect(isIncompleteSpec('1-3, 8')).toBe(false);
    expect(isIncompleteSpec('1-3,')).toBe(false);
    expect(isIncompleteSpec('-')).toBe(false);
  });

  it('labels group errors per tool', () => {
    expect(validateRangeGroups(['1', '9'], 5).error).toBe('Range 2: Page 9 is beyond the end of this document (5 pages).');
    expect(validateRangeGroups(Array(101).fill('1'), 5, { item: 'Group', empty: 'x', plural: 'groups' }).error).toBe('Use at most 100 groups.');
  });
});

describe('extractedFileName', () => {
  it('names outputs clearly', () => {
    expect(extractedFileName('Annual Report.pdf', { extractMode: 'single', pages: '2, 5' }, 'pdf')).toBe('Annual Report-extracted-pages.pdf');
    expect(extractedFileName('Annual Report.pdf', { extractMode: 'separate', pages: '2, 5' }, 'zip')).toBe('Annual Report-extracted-pages.zip');
    expect(extractedFileName('Annual Report.pdf', { extractMode: 'separate', pages: '7' }, 'pdf')).toBe('Annual Report-page-007.pdf');
    expect(extractedFileName('Annual Report.pdf', { extractMode: 'groups', groups: ['4-6'] }, 'pdf')).toBe('Annual Report-extracted-pages.pdf');
    expect(extractedFileName('.pdf', null, 'pdf')).toBe('document-extracted-pages.pdf');
  });
});
