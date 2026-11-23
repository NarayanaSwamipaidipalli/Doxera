'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isRenderCancelled, releaseCanvas, renderPage, scaleForWidth, type PageRender } from '@/lib/pdf/pdf-document';

const MAX_CONCURRENT_RENDERS = 2;
export const THUMBNAIL_CSS_WIDTH = 180;

export interface ThumbnailState {
  /** Object URLs of rendered thumbnails, keyed by 1-based page number. */
  urls: Record<number, string>;
  failed: Record<number, true>;
  /** Pages queued or currently rendering. */
  pending: number;
  /** Ask for a page to be rendered (when it scrolls near the viewport). */
  request: (page: number) => void;
  /** Drop a page from the queue if it has not started (it scrolled away). */
  release: (page: number) => void;
}

/**
 * Lazily renders page thumbnails to small JPEG object URLs. Each render uses a temporary canvas that
 * is released immediately, so memory stays proportional to the compressed thumbnails, not page
 * bitmaps. Everything (queue, in-flight renders, object URLs) is cleaned up when `doc` changes.
 */
export function useThumbnailRenderer(doc: PDFDocumentProxy | null): ThumbnailState {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState<Record<number, true>>({});
  const [pending, setPending] = useState(0);
  const queue = useRef<number[]>([]);
  const known = useRef(new Set<number>());
  const active = useRef(new Map<number, PageRender | null>());
  const objectUrls = useRef<string[]>([]);
  const generation = useRef(0);

  const updatePending = useCallback(() => setPending(queue.current.length + active.current.size), []);

  const pump = useCallback(() => {
    if (!doc) return;
    while (active.current.size < MAX_CONCURRENT_RENDERS && queue.current.length) {
      const pageNumber = queue.current.shift()!;
      const gen = generation.current;
      active.current.set(pageNumber, null);
      void (async () => {
        const canvas = document.createElement('canvas');
        let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;
        try {
          page = await doc.getPage(pageNumber);
          if (gen !== generation.current) return;
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('Canvas is unavailable');
          const render = renderPage(page, canvas, context, scaleForWidth(page, THUMBNAIL_CSS_WIDTH, window.devicePixelRatio || 1));
          active.current.set(pageNumber, render);
          await render.promise;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
          if (gen !== generation.current || !blob) return;
          const url = URL.createObjectURL(blob);
          objectUrls.current.push(url);
          setUrls((prev) => ({ ...prev, [pageNumber]: url }));
        } catch (error) {
          if (gen === generation.current && !isRenderCancelled(error)) setFailed((prev) => ({ ...prev, [pageNumber]: true }));
        } finally {
          releaseCanvas(canvas);
          page?.cleanup();
          if (gen === generation.current) {
            active.current.delete(pageNumber);
            updatePending();
            pump();
          }
        }
      })();
    }
    updatePending();
  }, [doc, updatePending]);

  const request = useCallback((page: number) => {
    if (!doc || known.current.has(page)) return;
    known.current.add(page);
    queue.current.push(page);
    pump();
  }, [doc, pump]);

  const release = useCallback((page: number) => {
    const index = queue.current.indexOf(page);
    if (index >= 0) {
      queue.current.splice(index, 1);
      known.current.delete(page);
      updatePending();
    }
  }, [updatePending]);

  useEffect(() => {
    const activeRenders = active.current;
    return () => {
      generation.current += 1;
      Array.from(activeRenders.values()).forEach((render) => render?.cancel());
      activeRenders.clear();
      queue.current = [];
      known.current = new Set();
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current = [];
      setUrls({});
      setFailed({});
      setPending(0);
    };
  }, [doc]);

  return { urls, failed, pending, request, release };
}
