import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { classifyPdfError, openPdf, PdfOpenError, releaseCanvas, renderPage, scaleForWidth } from '../pdf-document';
import { makePdf } from './make-pdf';

type Pdfjs = typeof import('pdfjs-dist');
let pdfjs: Pdfjs;

beforeAll(async () => {
  // The same legacy build the browser uses; in Node it runs its worker in-process.
  pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as Pdfjs;
});

describe('openPdf', () => {
  it('detects the real page count', async () => {
    for (const pages of [1, 3, 12]) {
      const opened = await openPdf(pdfjs, makePdf(pages));
      expect(opened.numPages).toBe(pages);
      await opened.destroy();
    }
  });

  it('handles a large document without rendering every page', async () => {
    const opened = await openPdf(pdfjs, makePdf(400));
    expect(opened.numPages).toBe(400);
    const last = await opened.doc.getPage(400);
    expect(last.pageNumber).toBe(400);
    await opened.destroy();
  });

  it('classifies password-protected documents', async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'encrypted.pdf')));
    await expect(openPdf(pdfjs, data)).rejects.toMatchObject({ name: 'PdfOpenError', kind: 'encrypted' });
  });

  it('classifies corrupted and non-PDF input', async () => {
    const garbage = new TextEncoder().encode('this is not a pdf at all');
    await expect(openPdf(pdfjs, garbage)).rejects.toBeInstanceOf(PdfOpenError);
    const truncated = makePdf(3).slice(0, 40);
    const error = await openPdf(pdfjs, truncated).catch((e) => e);
    expect(error).toBeInstanceOf(PdfOpenError);
    expect(['corrupt', 'unsupported']).toContain(error.kind);
  });

  it('maps PDF.js exception names to user-facing messages', () => {
    expect(classifyPdfError({ name: 'PasswordException' }).message).toMatch(/password-protected/);
    expect(classifyPdfError({ name: 'InvalidPDFException' }).kind).toBe('corrupt');
    expect(classifyPdfError(new Error('boom')).kind).toBe('unsupported');
  });

  it('destroy is idempotent', async () => {
    const opened = await openPdf(pdfjs, makePdf(2));
    await opened.destroy();
    await expect(opened.destroy()).resolves.toBeUndefined();
  });
});

describe('thumbnail rendering', () => {
  it('renders a page at thumbnail width with real page content', async () => {
    const opened = await openPdf(pdfjs, makePdf(2));
    const page = await opened.doc.getPage(2);
    const scale = scaleForWidth(page, 180, 1);
    const canvas = createCanvas(1, 1);
    const context = canvas.getContext('2d');
    await renderPage(page, canvas as unknown as HTMLCanvasElement, context as unknown as CanvasRenderingContext2D, scale).promise;
    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(Math.floor(180 * (792 / 612)));
    // The fixture draws a solid blue square at (100..300, 100..300) in PDF points (origin bottom-left).
    const s = 180 / 612;
    const [r, g, b] = context.getImageData(Math.round(200 * s), Math.round((792 - 200) * s), 1, 1).data;
    expect([r, g, b]).toEqual([0, 0, 255]);
    // White page background elsewhere.
    expect(Array.from(context.getImageData(2, 2, 1, 1).data.slice(0, 3))).toEqual([255, 255, 255]);
    await opened.destroy();
  });

  it('releases canvas memory by zeroing its size', () => {
    const fake = { width: 360, height: 466 } as HTMLCanvasElement;
    releaseCanvas(fake);
    expect([fake.width, fake.height]).toEqual([0, 0]);
    expect(() => releaseCanvas(null)).not.toThrow();
  });

  it('caps the device pixel ratio at 2', async () => {
    const opened = await openPdf(pdfjs, makePdf(1));
    const page = await opened.doc.getPage(1);
    expect(scaleForWidth(page, 180, 3)).toBeCloseTo((180 / 612) * 2);
    expect(scaleForWidth(page, 180, 0.5)).toBeCloseTo(180 / 612);
    await opened.destroy();
  });
});
