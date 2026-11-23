'use client';

import React, { useCallback } from 'react';
import { PageThumbnail, type SelectionTone } from './PageThumbnail';
import type { PdfPreview } from './usePdfPreview';

interface PageGridProps {
  /** 1-based page numbers to show, in display order. */
  pages: number[];
  preview: PdfPreview;
  aspectRatio: number;
  label: string;
  isSelected: (page: number) => boolean;
  selectable: boolean;
  disabled: boolean;
  tone?: SelectionTone;
  groupsFor?: (page: number) => number[] | undefined;
  groupLabel?: string;
  captionFor?: (page: number) => string | undefined;
  onActivate: (page: number, extendRange: boolean) => void;
  onPreview: (page: number) => void;
}

const THUMB_SELECTOR = 'button[data-testid^="page-thumb-"]';

/**
 * Arrow keys (up/down by row), Home and End move focus between the page buttons of a CSS grid.
 * Returns true when the key was handled.
 */
export function moveGridFocus(event: React.KeyboardEvent<HTMLElement>, selector = THUMB_SELECTOR): boolean {
  const target = event.target as HTMLElement;
  if (!target.matches(selector)) return false;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
  const index = buttons.indexOf(target);
  if (index < 0) return false;
  const columns = Math.max(1, getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').filter(Boolean).length);
  const moves: Record<string, number> = {
    ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns, Home: 0, End: buttons.length - 1,
  };
  if (!(event.key in moves) || event.altKey || event.ctrlKey || event.metaKey) return false;
  event.preventDefault();
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, moves[event.key]))];
  next?.focus();
  next?.scrollIntoView({ block: 'nearest' });
  return true;
}

/**
 * Responsive grid of lazily rendered page thumbnails. Keyboard: arrow keys move between pages
 * (up/down by row), Home/End jump to the first/last page, Space/Enter toggles, Shift+Space or
 * Shift+Enter selects every page from the last toggled one.
 */
export function PageGrid({
  pages, preview, aspectRatio, label, isSelected, selectable, disabled, tone, groupsFor, groupLabel, captionFor, onActivate, onPreview,
}: PageGridProps) {
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLOListElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(THUMB_SELECTOR)) return;
    const page = Number(target.closest('li')?.dataset.page);
    if ((event.key === ' ' || event.key === 'Enter') && event.shiftKey) {
      event.preventDefault();
      if (selectable && !disabled) onActivate(page, true);
      return;
    }
    moveGridFocus(event);
  }, [selectable, disabled, onActivate]);

  return (
    <ol
      className="grid grid-cols-2 gap-3 overflow-x-hidden sm:grid-cols-3 md:grid-cols-4 lg:max-h-[calc(100vh-14rem)] lg:grid-cols-3 lg:overflow-y-auto lg:p-1 lg:pr-2 xl:grid-cols-4"
      aria-label={label}
      data-testid="page-grid"
      onKeyDown={onKeyDown}
    >
      {pages.map((page) => (
        <PageThumbnail
          key={page}
          page={page}
          url={preview.thumbnails.urls[page]}
          failed={!!preview.thumbnails.failed[page]}
          selected={isSelected(page)}
          selectable={selectable}
          disabled={disabled}
          tone={tone}
          aspectRatio={aspectRatio}
          groups={groupsFor?.(page)}
          groupLabel={groupLabel}
          caption={captionFor?.(page)}
          observe={preview.observe}
          onActivate={onActivate}
          onPreview={onPreview}
        />
      ))}
    </ol>
  );
}
