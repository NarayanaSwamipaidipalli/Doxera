'use client';

import React, { memo, useEffect, useRef } from 'react';
import { Check, ImageOff, Loader2, Trash2, ZoomIn } from 'lucide-react';

/** `keep`: selected pages go into the output (blue). `remove`: selected pages are deleted (red). */
export type SelectionTone = 'keep' | 'remove';

interface PageThumbnailProps {
  page: number;
  url?: string;
  failed?: boolean;
  selected: boolean;
  selectable: boolean;
  disabled: boolean;
  /** Width / height of the page, used for the placeholder before the image renders. */
  aspectRatio: number;
  /** Output groups ("PDF 2") this page belongs to in range mode. */
  groups?: number[];
  /** Badge prefix for `groups`: "PDF" → "PDF 2". */
  groupLabel?: string;
  tone?: SelectionTone;
  /** Extra line under the page number, e.g. "New page 3". */
  caption?: string;
  observe: (element: Element, page: number) => () => void;
  onActivate: (page: number, extendRange: boolean) => void;
  onPreview: (page: number) => void;
}

function PageThumbnailBase({
  page, url, failed, selected, selectable, disabled, aspectRatio, groups, groupLabel = 'PDF', tone = 'keep', caption, observe, onActivate, onPreview,
}: PageThumbnailProps) {
  const remove = tone === 'remove';
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => (ref.current ? observe(ref.current, page) : undefined), [observe, page]);

  const stateLabel = selectable
    ? remove ? (selected ? ', marked for deletion' : ', kept') : (selected ? ', selected' : ', not selected')
    : '';
  return (
    <li ref={ref} data-page={page} className="group relative list-none" style={{ contentVisibility: 'auto', containIntrinsicSize: '180px 260px' }}>
      <button
        type="button"
        data-testid={`page-thumb-${page}`}
        data-selected={selected ? 'true' : 'false'}
        aria-pressed={selectable ? selected : undefined}
        aria-label={`Page ${page}${stateLabel}`}
        disabled={disabled || !selectable}
        onClick={(event) => onActivate(page, event.shiftKey)}
        className={`focus-ring relative block w-full overflow-hidden rounded-xl border-2 bg-white transition-[border-color,box-shadow] duration-150 ${
          selected
            ? remove ? 'border-rose-500 ring-2 ring-rose-500/30' : 'border-brand-500 shadow-glow'
            : remove
              ? 'border-black/10 hover:border-rose-500/60 dark:border-white/10 dark:hover:border-rose-400/60'
              : 'border-black/10 hover:border-brand-500/50 dark:border-white/10 dark:hover:border-brand-400/60'
        } ${selectable && !disabled ? 'cursor-pointer' : 'cursor-default'} disabled:opacity-100`}
      >
        <ThumbnailImage url={url} failed={failed} aspectRatio={aspectRatio} dimmed={remove && selected} />
        {selected && (
          <span className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-md ${remove ? 'bg-rose-600' : 'bg-brand-600'}`} aria-hidden>
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        )}
        {remove && selected && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-rose-600/95 py-1 text-[11px] font-semibold text-white" aria-hidden>
            <Trash2 className="h-3 w-3" aria-hidden /> Delete
          </span>
        )}
        {groups && groups.length > 0 && (
          <span className="absolute bottom-1.5 left-1.5 right-1.5 flex flex-wrap gap-1" aria-hidden>
            {groups.slice(0, 3).map((g) => (
              <span key={g} className="rounded-md bg-ink-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">{groupLabel} {g}</span>
            ))}
            {groups.length > 3 && <span className="rounded-md bg-ink-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">+{groups.length - 3}</span>}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onPreview(page)}
        aria-label={`Enlarge page ${page}`}
        title={`Enlarge page ${page}`}
        className="focus-ring absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-ink-900/70 text-white opacity-90 shadow-md transition-opacity hover:bg-ink-900 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <ZoomIn className="h-4 w-4" aria-hidden />
      </button>
      <div
        className={`mt-1.5 text-center text-xs font-medium tabular-nums ${
          selected ? (remove ? 'text-rose-600 line-through dark:text-rose-400' : 'text-brand-600 dark:text-brand-300') : 'text-ink-600 dark:text-zinc-400'
        }`}
        aria-hidden
      >
        {page}
      </div>
      {caption && <div className="text-center text-[10px] text-ink-500 dark:text-zinc-500" aria-hidden>{caption}</div>}
    </li>
  );
}

export const PageThumbnail = memo(PageThumbnailBase);

/** The rendered page image, or its loading / unavailable placeholder, at the page's aspect ratio. */
export function ThumbnailImage({ url, failed, aspectRatio, dimmed = false }: { url?: string; failed?: boolean; aspectRatio: number; dimmed?: boolean }) {
  return (
    <span className="block w-full" style={{ aspectRatio: String(aspectRatio || 0.773) }}>
      {url ? (
        // Blob URLs from the local renderer; next/image cannot optimise them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" draggable={false} className={`h-full w-full select-none object-contain transition-opacity ${dimmed ? 'opacity-40 grayscale' : ''}`} />
      ) : failed ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/[0.03] text-[10px] text-ink-500">
          <ImageOff className="h-5 w-5" aria-hidden /> Preview unavailable
        </span>
      ) : (
        <span className="skeleton flex h-full w-full items-center justify-center bg-black/[0.04]">
          <Loader2 className="h-5 w-5 animate-spin text-ink-400" aria-hidden />
        </span>
      )}
    </span>
  );
}
