'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPageSpec, isIncompleteSpec, parsePageSpec, selectRange, togglePage } from '@/lib/pdf/page-selection';

export const UNFINISHED_RANGE_ERROR = 'Finish typing the page range.';

export interface PageSelection {
  /** 1-based selected pages. */
  selected: Set<number>;
  /** Text of the typed page field. It is only reformatted when the field loses focus. */
  specText: string;
  /** Validation error to show under the typed field. */
  specError: string | null;
  /** Error that blocks processing: an invalid or unfinished typed selection. */
  inputError: string | null;
  apply: (next: Set<number>) => void;
  clear: () => void;
  /** Thumbnail click; `extendRange` (Shift) adds every page from the last clicked page. */
  activate: (page: number, extendRange: boolean) => void;
  toggle: (page: number) => void;
  /** Adds every page from `from` to `to` (either order), e.g. from the start/end picker. */
  addRange: (from: number, to: number) => void;
  changeSpec: (text: string) => void;
  blurSpec: () => void;
}

/**
 * Page selection shared by the page tools: thumbnails, buttons and the typed field stay in sync.
 * Typing a valid selection highlights those pages; an unfinished range ("1-3, 8-") is left alone
 * (no error, selection unchanged) until it is completed or the field loses focus.
 */
export function usePageSelection(pageCount: number, resetKey: unknown): PageSelection {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [specText, setSpecText] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setSpecText('');
    setSpecError(null);
    setPending(false);
    anchor.current = null;
  }, [resetKey]);

  const apply = useCallback((next: Set<number>) => {
    setSelected(next);
    setSpecText(formatPageSpec(next));
    setSpecError(null);
    setPending(false);
  }, []);

  const clear = useCallback(() => {
    apply(new Set());
    anchor.current = null;
  }, [apply]);

  const update = useCallback((change: (current: Set<number>) => Set<number>) => {
    setSelected((current) => {
      const next = change(current);
      setSpecText(formatPageSpec(next));
      return next;
    });
    setSpecError(null);
    setPending(false);
  }, []);

  const activate = useCallback((page: number, extendRange: boolean) => {
    const from = anchor.current;
    update((current) => (extendRange && from !== null ? selectRange(current, from, page, pageCount) : togglePage(current, page)));
    anchor.current = page;
  }, [pageCount, update]);

  const toggle = useCallback((page: number) => {
    update((current) => togglePage(current, page));
    anchor.current = page;
  }, [update]);

  const addRange = useCallback((from: number, to: number) => {
    update((current) => selectRange(current, from, to, pageCount));
    anchor.current = to;
  }, [pageCount, update]);

  const changeSpec = useCallback((text: string) => {
    setSpecText(text);
    if (!text.trim()) {
      setSelected(new Set());
      setSpecError(null);
      setPending(false);
      return;
    }
    if (isIncompleteSpec(text)) {
      setSpecError(null);
      setPending(true);
      return;
    }
    const result = parsePageSpec(text, pageCount);
    setPending(false);
    setSpecError(result.error);
    if (!result.error) setSelected(new Set(result.pages));
  }, [pageCount]);

  const blurSpec = useCallback(() => {
    if (!specText.trim()) return;
    if (pending) {
      const result = parsePageSpec(specText, pageCount);
      setPending(false);
      setSpecError(result.error);
      if (!result.error) setSelected(new Set(result.pages));
      return;
    }
    if (!specError) setSpecText(formatPageSpec(selected));
  }, [specText, pending, specError, selected, pageCount]);

  return {
    selected,
    specText,
    specError,
    inputError: specError ?? (pending ? UNFINISHED_RANGE_ERROR : null),
    apply,
    clear,
    activate,
    toggle,
    addRange,
    changeSpec,
    blurSpec,
  };
}
