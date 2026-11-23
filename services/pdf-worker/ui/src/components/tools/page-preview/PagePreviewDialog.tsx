'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Check, ChevronLeft, ChevronRight, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { SelectionTone } from './PageThumbnail';
import { isRenderCancelled, releaseCanvas, renderPage, scaleForWidth } from '@/lib/pdf/pdf-document';

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const DEFAULT_ZOOM_INDEX = 2;

interface PagePreviewDialogProps {
  doc: PDFDocumentProxy;
  page: number;
  pageCount: number;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: (page: number) => void;
  tone?: SelectionTone;
  /** Navigate in this order of original page numbers (Reorder) and show the new position. */
  sequence?: readonly number[];
  onNavigate: (page: number) => void;
  onClose: () => void;
}

export function PagePreviewDialog({ doc, page, pageCount, selected, selectable, onToggleSelect, tone = 'keep', sequence, onNavigate, onClose }: PagePreviewDialogProps) {
  const remove = tone === 'remove';
  const position = sequence ? sequence.indexOf(page) : page - 1;
  const previous = sequence ? sequence[position - 1] : page > 1 ? page - 1 : undefined;
  const next = sequence ? sequence[position + 1] : page < pageCount ? page + 1 : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fitWidth, setFitWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [cssSize, setCssSize] = useState<{ width: number; height: number } | null>(null);
  const [renderError, setRenderError] = useState(false);
  const zoom = ZOOM_LEVELS[zoomIndex];

  // Focus the dialog on open, restore focus to the opener on close, and lock background scroll.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  useLayoutEffect(() => {
    const measure = () => setFitWidth(Math.max(200, Math.min(900, (scrollRef.current?.clientWidth ?? 600) - 32)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    if (!fitWidth) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    const canvas = canvasRef.current;
    setRendering(true);
    setRenderError(false);
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled || !canvas) return;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas is unavailable');
        const cssWidth = fitWidth * zoom;
        const render = renderPage(pdfPage, canvas, context, scaleForWidth(pdfPage, cssWidth, window.devicePixelRatio || 1));
        cancelRender = render.cancel;
        await render.promise;
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setCssSize({ width: cssWidth, height: (cssWidth / base.width) * base.height });
        setRendering(false);
      } catch (error) {
        if (!cancelled && !isRenderCancelled(error)) {
          setRenderError(true);
          setRendering(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [doc, page, zoom, fitWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    return () => releaseCanvas(canvas);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'ArrowLeft' && previous !== undefined) { event.preventDefault(); onNavigate(previous); }
      else if (event.key === 'ArrowRight' && next !== undefined) { event.preventDefault(); onNavigate(next); }
      else if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey) { event.preventDefault(); setZoomIndex((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1)); }
      else if (event.key === '-' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); setZoomIndex((z) => Math.max(0, z - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previous, next, onClose, onNavigate]);

  const iconButton =
    'focus-ring flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-ink-950/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="split-preview-title" data-testid="page-preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-ink-950 px-3 py-2 text-white sm:px-5">
        <div className="flex items-center gap-1.5">
          <button type="button" className={iconButton} onClick={() => previous !== undefined && onNavigate(previous)} disabled={previous === undefined} aria-label="Previous page">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <h2 id="split-preview-title" className="min-w-[7.5rem] text-center text-sm font-semibold tabular-nums">
            {sequence ? `Position ${position + 1} of ${sequence.length} · Page ${page}` : `Page ${page} of ${pageCount}`}
          </h2>
          <button type="button" className={iconButton} onClick={() => next !== undefined && onNavigate(next)} disabled={next === undefined} aria-label="Next page">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={iconButton} onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0} aria-label="Zoom out">
            <ZoomOut className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
            className="focus-ring min-w-[4rem] rounded-full px-2 py-2 text-sm font-semibold tabular-nums hover:bg-white/10"
            aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to fit width`}
            data-testid="preview-zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className={iconButton} onClick={() => setZoomIndex((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))} disabled={zoomIndex === ZOOM_LEVELS.length - 1} aria-label="Zoom in">
            <ZoomIn className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {selectable && (
            <button
              type="button"
              onClick={() => onToggleSelect(page)}
              aria-pressed={selected}
              className={`focus-ring flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors ${
                selected
                  ? remove ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-brand-600 text-white hover:bg-brand-500'
                  : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {selected && <Check className="h-4 w-4" aria-hidden />}
              {remove ? (selected ? 'Marked for deletion' : 'Mark for deletion') : selected ? 'Selected' : 'Select page'}
            </button>
          )}
          <button ref={closeRef} type="button" className={iconButton} onClick={onClose} aria-label="Close preview">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto p-4"
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        <div className="mx-auto w-fit">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Page ${page} preview at ${Math.round(zoom * 100)} percent`}
            className={`block bg-white shadow-2xl transition-opacity ${rendering ? 'opacity-60' : 'opacity-100'}`}
            style={cssSize ? { width: cssSize.width, height: cssSize.height } : { width: fitWidth || undefined }}
          />
        </div>
        {rendering && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="polite">
            <span className="flex items-center gap-2 rounded-full bg-ink-900/80 px-4 py-2 text-sm text-white">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Rendering page {page}…
            </span>
          </div>
        )}
        {renderError && (
          <p className="mt-6 text-center text-sm text-rose-300" role="alert">This page could not be rendered.</p>
        )}
      </div>
    </div>
  );
}
