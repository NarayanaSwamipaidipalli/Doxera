'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Info, Loader2, PenLine, Presentation } from 'lucide-react';
import { describePageSize, summarisePageSizes, type PageSizeSummary, type PptMode, type PptRequest } from '@/lib/pdf/pdf-to-ppt';
import { PagePreviewDialog } from '../page-preview/PagePreviewDialog';
import { PageGrid } from '../page-preview/PageGrid';
import { PdfFileCard } from '../page-preview/PdfFileCard';
import { MobileActionBar, ModeSelector, SubmitPanel, type ModeOption } from '../page-preview/SelectionControls';
import { usePdfPreview } from '../page-preview/usePdfPreview';

interface PdfToPptWorkspaceProps {
  file: File;
  /** True while the upload/job is running: controls are locked and repeat submissions are ignored. */
  busy: boolean;
  onConvert: (request: PptRequest) => void;
  onRemoveFile: () => void;
}

const MODES: ModeOption<PptMode>[] = [
  { id: 'visual', title: 'Keep the original layout', description: 'Looks exactly like the PDF · not editable', icon: ImageIcon },
  { id: 'editable', title: 'Editable PowerPoint', description: 'Editable text, tables and shapes · layout may shift', icon: PenLine },
];

const EXPLANATIONS: Record<PptMode, { points: string[] }> = {
  visual: {
    points: [
      'Each page becomes one slide showing a high-resolution picture of the page, so fonts, tables, charts and images look exactly as in the PDF.',
      'The slide content is a picture: you cannot edit its text or move its parts. The page text is copied into the speaker notes so it stays searchable.',
      'Best for presenting or sharing the document as it is.',
    ],
  },
  editable: {
    points: [
      'Text becomes text boxes you can edit, with the original size, colour, bold and italic. Ruled tables become PowerPoint tables; simple rectangles, lines and pictures become separate objects.',
      'Anything that cannot be rebuilt (curves, gradients, rotated text) stays visible as a background picture behind the editable parts. Scanned pages stay pictures.',
      'Fonts that are not commonly installed are replaced by Arial, Times New Roman or Courier New, so lines can be slightly longer or shorter. Check the slides before presenting.',
    ],
  },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MAX_SIZE_SCAN = 500;

export function PdfToPptWorkspace({ file, busy, onConvert, onRemoveFile }: PdfToPptWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount, thumbnails } = preview;
  const [mode, setMode] = useState<PptMode>('visual');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [sizes, setSizes] = useState<PageSizeSummary | null>(null);

  useEffect(() => {
    setPreviewPage(null);
    setMode('visual');
  }, [file]);

  // Page sizes decide the slide size (the most common page size); only page objects are read, nothing is rendered.
  useEffect(() => {
    setSizes(null);
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      const list: { width: number; height: number }[] = [];
      for (let n = 1; n <= Math.min(pageCount, MAX_SIZE_SCAN) && !cancelled; n++) {
        const page = await doc.getPage(n);
        const { width, height } = page.getViewport({ scale: 1 });
        list.push({ width, height });
        page.cleanup();
      }
      if (!cancelled) setSizes(summarisePageSizes(list));
    })().catch(() => { /* size notice is informational only */ });
    return () => { cancelled = true; };
  }, [doc, pageCount]);

  const request: PptRequest | null = pageCount > 0 ? { pptMode: mode } : null;
  const submit = () => {
    if (request && !busy) onConvert(request);
  };
  const closePreview = useCallback(() => setPreviewPage(null), []);
  const notSelected = useCallback(() => false, []);
  const noop = useCallback(() => undefined, []);

  const slideSize = sizes?.sizes[0];
  const summary = useMemo(() => {
    if (!request) return null;
    return `${plural(pageCount, 'slide')}, one per page${slideSize ? ` · ${describePageSize(slideSize.width, slideSize.height)}` : ''}`;
  }, [request, pageCount, slideSize]);

  return (
    <section aria-label="PDF to PowerPoint workspace" className="space-y-5" data-testid="ppt-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="ppt" />

      {load.status === 'ready' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">Pages → slides</h3>
              <div className="flex items-center gap-3 text-xs text-ink-500 dark:text-zinc-400" aria-live="polite">
                {thumbnails.pending > 0 && (
                  <span className="inline-flex items-center gap-1.5" data-testid="render-status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rendering previews…
                  </span>
                )}
                <span className="font-semibold text-ink-800 dark:text-zinc-100" data-testid="ppt-page-count">{plural(pageCount, 'page')}</span>
              </div>
            </div>
            <p className="mb-3 text-xs text-ink-500 dark:text-zinc-400">Every page becomes one slide, in the same order. Use the magnifier to check a page.</p>
            <PageGrid
              pages={Array.from({ length: pageCount }, (_, i) => i + 1)}
              preview={preview}
              aspectRatio={load.aspectRatio}
              label={`${pageCount} pages`}
              isSelected={notSelected}
              selectable={false}
              disabled={busy}
              onActivate={noop}
              onPreview={setPreviewPage}
            />
            <MobileActionBar
              tone="brand" icon={Presentation} busy={busy} disabled={!request} onSubmit={submit}
              text={summary} label="Convert" busyLabel="Converting…" optionsHref="#ppt-options" testIdPrefix="ppt"
            />
          </div>

          <aside id="ppt-options" className="scroll-mt-24 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Conversion options">
            <ModeSelector<PptMode> legend="Conversion mode" modes={MODES} value={mode} onChange={setMode} disabled={busy} />

            <div className="rounded-xl border border-black/[0.07] bg-black/[0.02] p-3.5 dark:border-white/[0.07] dark:bg-white/[0.03]" data-testid="ppt-mode-explanation" aria-live="polite">
              <ul className="space-y-2 text-xs leading-relaxed text-ink-600 dark:text-zinc-300">
                {EXPLANATIONS[mode].points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-400" aria-hidden />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            {sizes?.mixed && slideSize && (
              <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200" data-testid="ppt-mixed-sizes">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  This PDF has pages of different sizes. A presentation has one slide size, so slides use the most common page size
                  ({describePageSize(slideSize.width, slideSize.height)}, {plural(slideSize.count, 'page')}). Other pages are scaled to fit
                  without cropping and centred, with white margins.
                </span>
              </div>
            )}

            <SubmitPanel
              tone="brand" icon={Presentation} busy={busy} disabled={!request} onSubmit={submit}
              label="Convert to PowerPoint" busyLabel="Converting…" testIdPrefix="ppt"
              summary={summary ? (
                <span className="text-ink-700 dark:text-zinc-200">You will get a <strong className="text-ink-900 dark:text-white">.pptx</strong> with {summary}.</span>
              ) : null}
            />
          </aside>
        </div>
      )}

      {previewPage !== null && doc && (
        <PagePreviewDialog
          doc={doc}
          page={previewPage}
          pageCount={pageCount}
          selected={false}
          selectable={false}
          onToggleSelect={noop}
          onNavigate={setPreviewPage}
          onClose={closePreview}
        />
      )}
    </section>
  );
}
