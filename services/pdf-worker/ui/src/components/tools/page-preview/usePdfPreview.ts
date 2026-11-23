'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs, openPdf, PdfOpenError, type OpenedPdf, type PdfOpenErrorKind } from '@/lib/pdf/pdf-document';
import { useThumbnailRenderer, type ThumbnailState } from './useThumbnailRenderer';

export type PdfLoadState =
  | { status: 'loading'; progress: number }
  | { status: 'ready'; doc: PDFDocumentProxy; pageCount: number; aspectRatio: number }
  | { status: 'error'; message: string; kind: PdfOpenErrorKind };

export interface PdfPreview {
  load: PdfLoadState;
  doc: PDFDocumentProxy | null;
  pageCount: number;
  thumbnails: ThumbnailState;
  /** Register a thumbnail element; it renders when it scrolls near the viewport. Returns the cleanup. */
  observe: (element: Element, page: number) => () => void;
}

/**
 * Opens a local PDF in the browser with PDF.js (nothing is uploaded for previews) and drives lazy
 * thumbnail rendering through one shared IntersectionObserver. The document, pending renders and
 * object URLs are released when the file changes or the component unmounts.
 */
export function usePdfPreview(file: File): PdfPreview {
  const [load, setLoad] = useState<PdfLoadState>({ status: 'loading', progress: 0 });

  useEffect(() => {
    let cancelled = false;
    let opened: OpenedPdf | null = null;
    let abortLoading: (() => void) | null = null;
    setLoad({ status: 'loading', progress: 0 });
    void (async () => {
      try {
        const [pdfjs, buffer] = await Promise.all([loadPdfjs(), file.arrayBuffer()]);
        if (cancelled) return;
        opened = await openPdf(pdfjs, new Uint8Array(buffer), {
          onTask: (task) => { abortLoading = () => void task.destroy(); },
          onProgress: (fraction) => { if (!cancelled) setLoad({ status: 'loading', progress: fraction }); },
        });
        if (cancelled) { void opened.destroy(); return; }
        const first = await opened.doc.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        first.cleanup();
        if (cancelled) return;
        setLoad({ status: 'ready', doc: opened.doc, pageCount: opened.numPages, aspectRatio: viewport.width / viewport.height });
      } catch (error) {
        if (cancelled) return;
        setLoad(error instanceof PdfOpenError
          ? { status: 'error', message: error.message, kind: error.kind }
          : { status: 'error', message: 'This PDF could not be previewed in your browser.', kind: 'unsupported' });
      }
    })();
    return () => {
      cancelled = true;
      abortLoading?.();
      void opened?.destroy();
    };
  }, [file]);

  const doc = load.status === 'ready' ? load.doc : null;
  const pageCount = load.status === 'ready' ? load.pageCount : 0;
  const thumbnails = useThumbnailRenderer(doc);

  const thumbnailsRef = useRef(thumbnails);
  thumbnailsRef.current = thumbnails;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observed = useRef(new Map<Element, number>());
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = observed.current.get(entry.target);
        if (page === undefined) continue;
        if (entry.isIntersecting) thumbnailsRef.current.request(page);
        else thumbnailsRef.current.release(page);
      }
    }, { rootMargin: '300px 0px' });
    observerRef.current = observer;
    Array.from(observed.current.keys()).forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [doc]);
  const observe = useCallback((element: Element, page: number) => {
    observed.current.set(element, page);
    observerRef.current?.observe(element);
    return () => {
      observed.current.delete(element);
      observerRef.current?.unobserve(element);
    };
  }, []);

  return { load, doc, pageCount, thumbnails, observe };
}
