'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Files, FileText, Layers, Loader2, Scissors } from 'lucide-react';
import { allPages, buildSplitPlan, formatPageSpec, type SplitMode, type SplitRequest } from '@/lib/pdf/page-selection';
import { PagePreviewDialog } from '../page-preview/PagePreviewDialog';
import { PageGrid } from '../page-preview/PageGrid';
import { PdfFileCard, secondaryButtonClass as secondaryButton } from '../page-preview/PdfFileCard';
import { RangeGroupsEditor, useRangeGroups } from '../page-preview/RangeGroupsEditor';
import { MobileActionBar, ModeSelector, PageSpecField, RangePicker, SubmitPanel, type ModeOption } from '../page-preview/SelectionControls';
import { usePageSelection } from '../page-preview/usePageSelection';
import { usePdfPreview } from '../page-preview/usePdfPreview';

interface SplitPdfWorkspaceProps {
  file: File;
  /** True while the upload/job is running: controls are locked. */
  busy: boolean;
  onSplit: (request: SplitRequest) => void;
  onRemoveFile: () => void;
}

export function SplitPdfWorkspace({ file, busy, onSplit, onRemoveFile }: SplitPdfWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount, thumbnails } = preview;
  const selection = usePageSelection(pageCount, file);
  const groups = useRangeGroups(pageCount, file);
  const [mode, setMode] = useState<SplitMode>('extract');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const { selected } = selection;

  useEffect(() => {
    setPreviewPage(null);
    setAttempted(false);
  }, [file]);

  const modes: ModeOption<SplitMode>[] = [
    { id: 'extract', title: 'Extract selected pages', description: 'Selected pages → one new PDF', icon: FileText },
    {
      id: 'every',
      title: 'Split every page',
      description: `${pageCount} page${pageCount === 1 ? '' : 's'} → ${pageCount} PDF${pageCount === 1 ? '' : 's'}${pageCount > 1 ? ' (ZIP)' : ''}`,
      icon: Files,
    },
    { id: 'ranges', title: 'Split by ranges', description: 'One PDF per range; multiple PDFs download as a ZIP', icon: Layers },
  ];

  const plan = useMemo(() => {
    if (mode === 'extract' && selection.inputError) return { request: null, error: selection.inputError, outputs: 0, zipped: false };
    return buildSplitPlan(mode, pageCount, selected, groups.texts);
  }, [mode, selection.inputError, pageCount, selected, groups.texts]);

  const submit = () => {
    setAttempted(true);
    if (plan.request && !busy) onSplit(plan.request);
  };
  const closePreview = useCallback(() => setPreviewPage(null), []);
  const isSelected = useCallback((page: number) => mode !== 'every' && selected.has(page), [mode, selected]);
  const groupsFor = useCallback((page: number) => (mode === 'ranges' ? groups.pageGroups.get(page) : undefined), [mode, groups.pageGroups]);

  const summary = (() => {
    if (!plan.request) return null;
    if (mode === 'extract') return `1 PDF with ${selected.size} page${selected.size === 1 ? '' : 's'}`;
    if (plan.zipped) return `${plan.outputs} PDFs in one ZIP file`;
    return '1 PDF';
  })();

  return (
    <section aria-label="Split PDF workspace" className="space-y-5" data-testid="split-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="split" />

      {load.status === 'ready' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Page grid */}
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">Pages</h3>
              <div className="flex items-center gap-3 text-xs text-ink-500 dark:text-zinc-400" aria-live="polite">
                {thumbnails.pending > 0 && (
                  <span className="inline-flex items-center gap-1.5" data-testid="render-status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rendering previews…
                  </span>
                )}
                {mode !== 'every' && (
                  <span className="font-semibold text-ink-800 dark:text-zinc-100" data-testid="selected-count">
                    {selected.size} of {pageCount} selected
                  </span>
                )}
              </div>
            </div>
            <p className="mb-3 text-xs text-ink-500 dark:text-zinc-400">
              {mode !== 'every' ? (
                <>Tap pages to select them. <span className="hidden sm:inline">Shift-click selects every page in between; arrow keys move between pages. </span>Use the magnifier to enlarge a page.</>
              ) : (
                'Every page becomes its own PDF. Use the magnifier to check a page.'
              )}
            </p>
            <PageGrid
              pages={Array.from({ length: pageCount }, (_, i) => i + 1)}
              preview={preview}
              aspectRatio={load.aspectRatio}
              label={`${pageCount} pages`}
              isSelected={isSelected}
              selectable={mode !== 'every'}
              disabled={busy}
              groupsFor={groupsFor}
              onActivate={selection.activate}
              onPreview={setPreviewPage}
            />
            <MobileActionBar
              tone="brand" icon={Scissors} busy={busy} disabled={!plan.request} onSubmit={submit}
              text={summary ?? plan.error} label="Split" busyLabel="Splitting…" optionsHref="#split-options" testIdPrefix="split"
            />
          </div>

          {/* Controls */}
          <aside id="split-options" className="scroll-mt-24 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Split options">
            <ModeSelector<SplitMode> legend="Split mode" modes={modes} value={mode} onChange={setMode} disabled={busy} />

            {mode === 'extract' && (
              <fieldset disabled={busy} className="space-y-4">
                <PageSpecField
                  selection={selection} pageCount={pageCount} label="Enter pages or ranges" placeholder="e.g. 1-3, 5, 8-12"
                  help="Pages are kept in document order." testId="page-spec-input" errorTestId="page-spec-error"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={secondaryButton} onClick={() => selection.apply(allPages(pageCount))} disabled={selected.size === pageCount}>
                    Select all
                  </button>
                  <button type="button" className={secondaryButton} onClick={selection.clear} disabled={selected.size === 0 && !selection.specText}>
                    Clear selection
                  </button>
                </div>
                <RangePicker
                  pageCount={pageCount} title="Select a start and end page" applyLabel="Select" fromLabel="Start page" toLabel="End page"
                  onApply={selection.addRange}
                />
              </fieldset>
            )}

            {mode === 'every' && (
              <p className="rounded-xl border border-black/[0.07] bg-black/[0.02] p-3.5 text-xs leading-relaxed text-ink-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-zinc-300">
                {pageCount > 1
                  ? `Each of the ${pageCount} pages becomes its own PDF, named by page number and delivered together in one ZIP file.`
                  : 'This document has a single page, so you will get one PDF.'}
              </p>
            )}

            {mode === 'ranges' && (
              <RangeGroupsEditor
                state={groups} pageCount={pageCount} legend="Output PDFs" itemLabel="PDF" attempted={attempted} disabled={busy}
                selectedCount={selected.size}
                onUseSelection={() => { groups.add(formatPageSpec(selected)); selection.clear(); }}
                onClearSelection={selection.clear}
              />
            )}

            <SubmitPanel
              tone="brand" icon={Scissors} busy={busy} disabled={!plan.request} onSubmit={submit}
              label="Split PDF" busyLabel="Splitting…" testIdPrefix="split"
              summary={summary ? (
                <span className="text-ink-700 dark:text-zinc-200">You will get <strong className="text-ink-900 dark:text-white">{summary}</strong>.</span>
              ) : (
                <span className={attempted ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-zinc-400'}>{plan.error}</span>
              )}
            />
          </aside>
        </div>
      )}

      {previewPage !== null && doc && (
        <PagePreviewDialog
          doc={doc}
          page={previewPage}
          pageCount={pageCount}
          selected={selected.has(previewPage)}
          selectable={mode !== 'every' && !busy}
          onToggleSelect={selection.toggle}
          onNavigate={setPreviewPage}
          onClose={closePreview}
        />
      )}
    </section>
  );
}
