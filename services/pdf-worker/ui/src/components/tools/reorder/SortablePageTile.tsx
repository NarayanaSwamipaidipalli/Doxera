'use client';

import React, { memo, useCallback, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, ZoomIn } from 'lucide-react';
import { ThumbnailImage } from '../page-preview/PageThumbnail';

interface SortablePageTileProps {
  /** Original page number: the tile's identity, never changes. */
  page: number;
  /** 1-based position in the new order. */
  position: number;
  url?: string;
  failed?: boolean;
  aspectRatio: number;
  selected: boolean;
  /** Another tile of the selection is being dragged and this one travels with it. */
  travelling: boolean;
  disabled: boolean;
  reduceMotion: boolean;
  observe: (element: Element, page: number) => () => void;
  onActivate: (page: number, extendRange: boolean) => void;
  onPreview: (page: number) => void;
}

/**
 * A draggable page. Mouse: drag anywhere on the tile (after 6 px). Touch: press and hold, then
 * drag. Keyboard: focus the grip, Space to pick up, arrow keys to move, Space to drop, Esc to cancel.
 * While dragging, this tile's slot becomes the drop indicator (dashed outline).
 */
function SortablePageTileBase({
  page, position, url, failed, aspectRatio, selected, travelling, disabled, reduceMotion, observe, onActivate, onPreview,
}: SortablePageTileProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: page, disabled });
  const element = useRef<HTMLLIElement | null>(null);
  const ref = useCallback((node: HTMLLIElement | null) => {
    element.current = node;
    setNodeRef(node);
  }, [setNodeRef]);
  useEffect(() => (element.current ? observe(element.current, page) : undefined), [observe, page]);

  const moved = page !== position;
  return (
    <li
      ref={ref}
      data-page={page}
      data-position={position}
      className="group relative list-none touch-manipulation"
      style={{
        transform: CSS.Translate.toString(transform),
        transition: reduceMotion ? undefined : transition,
        contentVisibility: 'auto',
        containIntrinsicSize: '180px 270px',
      }}
      {...listeners}
    >
      <div className={`relative rounded-xl ${isDragging ? 'outline-dashed outline-2 outline-offset-2 outline-brand-500' : ''}`} data-testid={isDragging ? 'drop-indicator' : undefined}>
        <button
          type="button"
          data-testid={`page-thumb-${page}`}
          aria-pressed={selected}
          aria-label={`Position ${position}, original page ${page}${selected ? ', selected' : ''}`}
          disabled={disabled}
          onClick={(event) => onActivate(page, event.shiftKey)}
          className={`focus-ring relative block w-full overflow-hidden rounded-xl border-2 bg-white transition-[border-color,box-shadow,opacity] duration-150 disabled:opacity-100 ${
            selected ? 'border-brand-500 shadow-glow' : 'border-black/10 hover:border-brand-500/50 dark:border-white/10 dark:hover:border-brand-400/60'
          } ${isDragging ? 'opacity-30' : travelling ? 'opacity-40' : ''} ${disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
        >
          <ThumbnailImage url={url} failed={failed} aspectRatio={aspectRatio} />
          {selected && (
            <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white shadow-md" aria-hidden>
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onPreview(page)}
          aria-label={`Enlarge original page ${page}`}
          title={`Enlarge page ${page}`}
          className="focus-ring absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-ink-900/70 text-white opacity-90 shadow-md transition-opacity hover:bg-ink-900 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          aria-label={`Drag original page ${page}, now at position ${position}. Press Space to pick up, arrow keys to move, Space to drop.`}
          title="Drag to move"
          disabled={disabled}
          data-testid={`drag-handle-${page}`}
          className="focus-ring absolute bottom-1.5 right-1.5 flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-full bg-ink-900/70 text-white shadow-md hover:bg-ink-900 active:cursor-grabbing disabled:opacity-40"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5 text-xs" aria-hidden>
        <span
          className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${selected ? 'bg-brand-600 text-white' : 'bg-brand-500/10 text-brand-700 dark:text-brand-200'}`}
          data-testid={`position-${page}`}
          title="New position"
        >
          {position}
        </span>
        <span className={`truncate tabular-nums ${moved ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-ink-500 dark:text-zinc-400'}`} title="Original page number">
          Page {page}
        </span>
      </div>
    </li>
  );
}

export const SortablePageTile = memo(SortablePageTileBase);

/** What follows the pointer while dragging: the page, plus a count when a selection moves together. */
export function DragPreview({ url, failed, aspectRatio, page, count }: { url?: string; failed?: boolean; aspectRatio: number; page: number; count: number }) {
  return (
    <div className="relative w-full cursor-grabbing" data-testid="drag-preview">
      {count > 1 && <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-xl border-2 border-brand-500/60 bg-white/80" aria-hidden />}
      <div className="relative overflow-hidden rounded-xl border-2 border-brand-500 bg-white shadow-2xl ring-4 ring-brand-500/20">
        <ThumbnailImage url={url} failed={failed} aspectRatio={aspectRatio} />
      </div>
      <span className="absolute -right-2 -top-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white shadow-md">
        {count > 1 ? `${count} pages` : `Page ${page}`}
      </span>
    </div>
  );
}
