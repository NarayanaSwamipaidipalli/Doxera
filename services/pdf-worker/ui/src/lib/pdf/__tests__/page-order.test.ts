import { describe, expect, it } from 'vitest';
import {
  dropPages, formatPageOrder, initHistory, insertGroupAt, isOriginalOrder, movedCount, moveLeft, moveRight, moveToEnd, moveToStart,
  originalOrder, pagesBetween, parsePageOrder, pushOrder, redoOrder, reorderedFileName, reverseOrder, undoOrder,
} from '../page-order';

const isPermutation = (order: number[], n: number) => order.length === n && new Set(order).size === n && order.every((p) => p >= 1 && p <= n);

describe('parsePageOrder (Custom Page Order)', () => {
  it('accepts a complete order, with ranges in either direction', () => {
    expect(parsePageOrder('3, 1, 5, 2, 4', 5)).toEqual({ status: 'valid', order: [3, 1, 5, 2, 4] });
    expect(parsePageOrder('5, 1-4', 5)).toEqual({ status: 'valid', order: [5, 1, 2, 3, 4] });
    expect(parsePageOrder('5-1', 5)).toEqual({ status: 'valid', order: [5, 4, 3, 2, 1] });
    expect(parsePageOrder(' 2 ,1, ', 2)).toEqual({ status: 'valid', order: [2, 1] });
  });

  it.each([
    ['3, 1, 3, 2, 4', 'Page 3 appears more than once.'],
    ['1-3, 2, 4, 5', 'Page 2 appears more than once.'],
    ['1, 2, 3, 4, 6', 'Page 6 is beyond the end of this document (5 pages).'],
    ['1-9', 'Page 6 is beyond the end of this document (5 pages).'],
    ['0, 1, 2, 3, 4', 'Page numbers start at 1 (found 0).'],
    ['-1, 2', 'Page numbers must be positive (found "-1").'],
    ['1, two, 3', 'Could not understand "two". Use page numbers like 3, 1, 5-2.'],
    ['1.5', 'Could not understand "1.5". Use page numbers like 3, 1, 5-2.'],
  ])('rejects %j immediately', (input, message) => {
    expect(parsePageOrder(input, 5)).toEqual({ status: 'invalid', message });
  });

  it('reports missing pages as incomplete (the user may still be typing)', () => {
    expect(parsePageOrder('3, 1', 5)).toEqual({
      status: 'incomplete', missing: [2, 4, 5], message: 'Pages 2, 4, 5 are missing. Every page must appear exactly once.',
    });
    expect(parsePageOrder('2, 3, 4, 5', 5)).toMatchObject({ status: 'incomplete', message: 'Page 1 is missing. Every page must appear exactly once.' });
    expect(parsePageOrder('', 5)).toMatchObject({ status: 'incomplete', message: 'Enter the new page order.' });
    expect(parsePageOrder('1', 30)).toMatchObject({ message: 'Pages 2, 3, 4, 5, 6, 7, 8, 9 and 21 more are missing. Every page must appear exactly once.' });
  });

  it('treats a trailing "5-" as a range still being typed', () => {
    expect(parsePageOrder('1, 2, 5-', 5)).toMatchObject({ status: 'incomplete', missing: [3, 4, 5] });
    expect(parsePageOrder('1-5, 5-', 5)).toMatchObject({ status: 'incomplete', message: 'Finish typing the page range.' });
  });
});

describe('formatPageOrder', () => {
  it('collapses runs and round-trips with the parser', () => {
    expect(formatPageOrder([5, 1, 2, 3, 4])).toBe('5, 1-4');
    expect(formatPageOrder([3, 1, 5, 2, 4])).toBe('3, 1, 5, 2, 4');
    expect(formatPageOrder([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe('10-1');
    expect(formatPageOrder([2, 1, 3])).toBe('2, 1, 3');
    for (const order of [[5, 1, 2, 3, 4], [3, 1, 5, 2, 4], [6, 5, 4, 1, 2, 3], [2, 1, 4, 3, 6, 5], [1, 2, 3, 4, 5, 6]]) {
      expect(parsePageOrder(formatPageOrder(order), order.length)).toEqual({ status: 'valid', order });
    }
  });
});

describe('moves', () => {
  const five = originalOrder(5);

  it('drags one page: page 5 to the beginning gives 5, 1, 2, 3, 4', () => {
    expect(dropPages(five, 5, 1)).toEqual([5, 1, 2, 3, 4]);
    expect(dropPages(five, 1, 3)).toEqual([2, 3, 1, 4, 5]);
    expect(dropPages(five, 4, 2)).toEqual([1, 4, 2, 3, 5]);
    expect(dropPages(five, 2, 2)).toEqual(five);
  });

  it('drags a selected group together, keeping its relative order', () => {
    // Pages 2 and 4 selected; drag page 4 onto page 1 → both land at the start.
    expect(dropPages(five, 4, 1, new Set([2, 4]))).toEqual([2, 4, 1, 3, 5]);
    // Drag page 1 (selected with 3) to the end.
    expect(dropPages(five, 1, 5, new Set([1, 3]))).toEqual([2, 4, 5, 1, 3]);
    // Dragging an unselected page ignores the selection.
    expect(dropPages(five, 5, 1, new Set([2, 3]))).toEqual([5, 1, 2, 3, 4]);
  });

  it('moves to the beginning and end', () => {
    expect(moveToStart(five, [5])).toEqual([5, 1, 2, 3, 4]);
    expect(moveToStart(five, [2, 4])).toEqual([2, 4, 1, 3, 5]);
    expect(moveToEnd(five, [1])).toEqual([2, 3, 4, 5, 1]);
    expect(moveToEnd(five, [3, 1])).toEqual([2, 4, 5, 1, 3]);
  });

  it('moves left and right one step, stopping at the edges', () => {
    expect(moveLeft(five, [3])).toEqual([1, 3, 2, 4, 5]);
    expect(moveRight(five, [3])).toEqual([1, 2, 4, 3, 5]);
    expect(moveLeft(five, [1])).toEqual(five);
    expect(moveRight(five, [5])).toEqual(five);
    expect(moveRight(five, [2, 3])).toEqual([1, 4, 2, 3, 5]);
    expect(moveLeft([5, 1, 2, 3, 4], [2, 3])).toEqual([5, 2, 3, 1, 4]);
  });

  it('reverses and identifies the original order', () => {
    expect(reverseOrder(five)).toEqual([5, 4, 3, 2, 1]);
    expect(isOriginalOrder(five)).toBe(true);
    expect(isOriginalOrder([2, 1])).toBe(false);
    expect(movedCount([5, 1, 2, 3, 4])).toBe(5);
    expect(movedCount([2, 1, 3])).toBe(2);
  });

  it('never drops or duplicates pages, whatever the sequence of moves', () => {
    let order = originalOrder(40);
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 48271) % 2147483647; return seed % n; };
    for (let i = 0; i < 500; i++) {
      const group = new Set([rand(40) + 1, rand(40) + 1, rand(40) + 1]);
      switch (rand(6)) {
        case 0: order = dropPages(order, order[rand(40)], order[rand(40)], group); break;
        case 1: order = moveLeft(order, group); break;
        case 2: order = moveRight(order, group); break;
        case 3: order = moveToStart(order, group); break;
        case 4: order = moveToEnd(order, group); break;
        default: order = insertGroupAt(order, group, rand(41));
      }
      expect(isPermutation(order, 40)).toBe(true);
    }
  });

  it('finds the pages between two pages in the current order (Shift-click)', () => {
    expect(pagesBetween([5, 1, 2, 3, 4], 5, 2)).toEqual([5, 1, 2]);
    expect(pagesBetween([5, 1, 2, 3, 4], 3, 1)).toEqual([1, 2, 3]);
  });
});

describe('undo / redo history', () => {
  it('undoes, redoes, and clears redo on a new change', () => {
    let h = initHistory([1, 2, 3]);
    h = pushOrder(h, [3, 1, 2]);
    h = pushOrder(h, [3, 2, 1]);
    h = undoOrder(h);
    expect(h.present).toEqual([3, 1, 2]);
    h = undoOrder(h);
    expect(h.present).toEqual([1, 2, 3]);
    expect(undoOrder(h)).toBe(h);
    h = redoOrder(h);
    expect(h.present).toEqual([3, 1, 2]);
    h = pushOrder(h, [2, 3, 1]);
    expect(h.future).toEqual([]);
    expect(redoOrder(h)).toBe(h);
  });

  it('ignores no-op changes and makes reset undoable', () => {
    let h = initHistory([1, 2, 3]);
    expect(pushOrder(h, [1, 2, 3])).toBe(h);
    h = pushOrder(h, [3, 2, 1]);
    h = pushOrder(h, [1, 2, 3]); // reset to original
    expect(undoOrder(h).present).toEqual([3, 2, 1]);
  });
});

describe('reorderedFileName', () => {
  it('names the output after the original', () => {
    expect(reorderedFileName('Quarterly Plan.pdf')).toBe('Quarterly Plan-reordered.pdf');
    expect(reorderedFileName('.pdf')).toBe('document-reordered.pdf');
  });
});
