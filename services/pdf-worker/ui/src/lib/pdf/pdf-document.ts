/**
 * Client-side PDF loading and page rendering (PDF.js, legacy build for broad browser support).
 *
 * Previews use the display API with XFA disabled and no viewer scripting manager.
 * Callers own the returned document and must call `destroy()` when finished.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');

export type PdfOpenErrorKind = 'encrypted' | 'corrupt' | 'empty' | 'unsupported';

export const PDF_OPEN_ERROR_MESSAGES: Record<PdfOpenErrorKind, string> = {
  encrypted: 'This PDF is password-protected. Remove the password with Unlock PDF first.',
  corrupt: 'This file could not be read as a PDF. It may be damaged or not a PDF at all.',
  empty: 'This PDF has no pages.',
  unsupported: 'This PDF could not be previewed in your browser.',
};

export class PdfOpenError extends Error {
  constructor(public readonly kind: PdfOpenErrorKind) {
    super(PDF_OPEN_ERROR_MESSAGES[kind]);
    this.name = 'PdfOpenError';
  }
}

export function classifyPdfError(error: unknown): PdfOpenError {
  if (error instanceof PdfOpenError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'PasswordException') return new PdfOpenError('encrypted');
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || name === 'FormatError') return new PdfOpenError('corrupt');
  return new PdfOpenError('unsupported');
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** Lazily loads PDF.js in the browser and points it at its bundled worker. */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
    const pdfjs = mod as unknown as PdfjsModule;
    if (typeof window !== 'undefined') {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    }
    return pdfjs;
  }).catch((error) => {
    pdfjsPromise = null;
    throw error;
  });
  return pdfjsPromise;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  numPages: number;
  /** Cancels loading or releases the parsed document and its worker. Safe to call repeatedly. */
  destroy: () => Promise<void>;
}

export interface OpenPdfOptions {
  onProgress?: (fraction: number) => void;
  /** Receives the loading task immediately, so a caller can abort while parsing. */
  onTask?: (task: PDFDocumentLoadingTask) => void;
}

/** Opens PDF bytes and reports the real page count. Throws PdfOpenError for unreadable documents. */
export async function openPdf(pdfjs: PdfjsModule, data: Uint8Array, options: OpenPdfOptions = {}): Promise<OpenedPdf> {
  const task = pdfjs.getDocument({
    data,
    enableXfa: false,
    disableAutoFetch: true,
    stopAtErrors: false,
  });
  options.onTask?.(task);
  if (options.onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0) options.onProgress?.(Math.min(1, loaded / total));
    };
  }
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw classifyPdfError(error);
  }
  if (doc.numPages < 1) {
    await task.destroy().catch(() => undefined);
    throw new PdfOpenError('empty');
  }
  let destroyed = false;
  return {
    doc,
    numPages: doc.numPages,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      await task.destroy().catch(() => undefined);
    },
  };
}

/** Scale that renders `page` at `cssWidth` CSS pixels wide, sharpened for the device pixel ratio (capped). */
export function scaleForWidth(page: PDFPageProxy, cssWidth: number, pixelRatio = 1): number {
  const base = page.getViewport({ scale: 1 });
  return (cssWidth / base.width) * Math.min(Math.max(pixelRatio, 1), 2);
}

export interface PageRender {
  promise: Promise<void>;
  cancel: () => void;
}

/** Renders one page into `canvas` (resized to fit). Cancelling rejects `promise` with a RenderingCancelledException. */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  scale: number,
): PageRender {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task: RenderTask = page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' });
  return { promise: task.promise, cancel: () => task.cancel() };
}

export function isRenderCancelled(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'RenderingCancelledException';
}

/** Frees the backing store of a canvas immediately instead of waiting for garbage collection. */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
