'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CopyCheck, Files, FileText, Layers, Loader2 } from 'lucide-react';
import { allPages, formatPageSpec } from '@/lib/pdf/page-selection';
import { buildExtractPlan, type ExtractMode, type ExtractRequest } from '@/lib/pdf/extract-selection';
import { PagePreviewDialog } from '../page-preview/PagePreviewDialog';
import { PageGrid } from '../page-preview/PageGrid';
import { PdfFileCard, secondaryButtonClass as secondaryButton } from '../page-preview/PdfFileCard';
import { RangeGroupsEditor, useRangeGroups } from '../page-preview/RangeGroupsEditor';
import { MobileActionBar, ModeSelector, PageSpecField, RangePicker, SubmitPanel, type ModeOption } from '../page-preview/SelectionControls';
import { usePageSelection } from '../page-preview/usePageSelection';
import { usePdfPreview } from '../page-preview/usePdfPreview';

interface ExtractPagesWorkspaceProps {
  file: File;
  /** True while the upload/job is running: controls are locked and repeat submissions are ignored. */
  busy: boolean;
  onExtract: (request: ExtractRequest) => void;
  onRemoveFile: () => void;
}

const MODES: ModeOption<ExtractMode>[] = [
  { id: 'single', title: 'Extract to one PDF', description: 'Selected pages → one new PDF', icon: FileText },
  { id: 'separate', title: 'Extract as separate PDFs', description: 'Each selected page → its own PDF (ZIP)', icon: Files },
  { id: 'groups', title: 'Extract page groups', description: 'Each group → its own PDF (ZIP)', icon: Layers },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ExtractPagesWorkspace({ file, busy, onExtract, onRemoveFile }: ExtractPagesWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount, thumbnails } = preview;
  const selection = usePageSelection(pageCount, file);
  const groups = useRangeGroups(pageCount, file);
  const [mode, setMode] = useState<ExtractMode>('single');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const { selected } = selection;

  useEffect(() => {
    setPreviewPage(null);
    setAttempted(false);
  }, [file]);

  const plan = useMemo(
    () => buildExtractPlan(mode, pageCount, selected, groups.texts, selection.inputError),
    [mode, pageCount, selected, groups.texts, selection.inputError],
  );

  const submit = () => {
    setAttempted(true);
    if (plan.request && !busy) onExtract(plan.request);
  };
  const closePreview = useCallback(() => setPreviewPage(null), []);
  const isSelected = useCallback((page: number) => selected.has(page), [selected]);
  const groupsFor = useCallback((page: number) => (mode === 'groups' ? groups.pageGroups.get(page) : undefined), [mode, groups.pageGroups]);

  const summary = (() => {
    if (!plan.request) return null;
    if (mode === 'single') return `1 PDF with ${plural(plan.pageTotal, 'page')}`;
    if (plan.zipped) return `${plan.outputs} PDFs in one ZIP file`;
    return '1 PDF';
  })();

  return (
    <section aria-label="Extract PDF pages workspace" className="space-y-5" data-testid="extract-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="extract" />

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
                <span className="font-semibold text-ink-800 dark:text-zinc-100" data-testid="selected-count">
                  {selected.size} of {pageCount} selected
                </span>
              </div>
            </div>
            <p className="mb-3 text-xs text-ink-500 dark:text-zinc-400">
              {mode === 'groups'
                ? 'Select pages and add them as a group, or type each group on the right. '
                : 'Tap the pages you want to extract. '}
              <span className="hidden sm:inline">Shift-click selects every page in between; arrow keys move between pages. </span>
              Use the magnifier to enlarge a page.
            </p>
            <PageGrid
              pages={Array.from({ length: pageCount }, (_, i) => i + 1)}
              preview={preview}
              aspectRatio={load.aspectRatio}
              label={`${pageCount} pages`}
              isSelected={isSelected}
              selectable
              disabled={busy}
              groupsFor={groupsFor}
              groupLabel="Output"
              onActivate={selection.activate}
              onPreview={setPreviewPage}
            />
            <MobileActionBar
              tone="brand" icon={CopyCheck} busy={busy} disabled={!plan.request} onSubmit={submit}
              text={summary ?? plan.error} label="Extract" busyLabel="Extracting…" optionsHref="#extract-options" testIdPrefix="extract"
            />
          </div>

          {/* Controls */}
          <aside id="extract-options" className="scroll-mt-24 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Extraction options">
            <ModeSelector<ExtractMode> legend="Extraction mode" modes={MODES} value={mode} onChange={setMode} disabled={busy} />

            {mode !== 'groups' && (
              <fieldset disabled={busy} className="space-y-4">
                <PageSpecField
                  selection={selection} pageCount={pageCount} label="Pages to Extract" placeholder="e.g. 1-3, 8, 10-12"
                  help="Pages are kept in document order." testId="extract-spec-input" errorTestId="extract-spec-error"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={secondaryButton} onClick={() => selection.apply(allPages(pageCount))} disabled={selected.size === pageCount} data-testid="select-all">
                    Select all
                  </button>
                  <button type="button" className={secondaryButton} onClick={selection.clear} disabled={selected.size === 0 && !selection.specText} data-testid="clear-selection">
                    Clear selection
                  </button>
                </div>
                <RangePicker
                  pageCount={pageCount} title="Select a start and end page" applyLabel="Select" fromLabel="Start page" toLabel="End page"
                  onApply={selection.addRange}
                />
                {mode === 'separate' && (
                  <p className="rounded-xl border border-black/[0.07] bg-black/[0.02] p-3.5 text-xs leading-relaxed text-ink-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-zinc-300">
                    Each selected page becomes its own PDF, named by page number (for example <span className="font-mono">page-007.pdf</span>).
                    More than one file is delivered as a ZIP.
                  </p>
                )}
              </fieldset>
            )}

            {mode === 'groups' && (
              <RangeGroupsEditor
                state={groups} pageCount={pageCount} legend="Output groups" itemLabel="Output" chunkLabel="Group every N pages"
                attempted={attempted} disabled={busy} selectedCount={selected.size}
                onUseSelection={() => { groups.add(formatPageSpec(selected)); selection.clear(); }}
                onClearSelection={selection.clear}
              />
            )}

            <SubmitPanel
              tone="brand" icon={CopyCheck} busy={busy} disabled={!plan.request} onSubmit={submit}
              label="Extract PDF" busyLabel="Extracting…" testIdPrefix="extract"
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
          selectable={!busy}
          onToggleSelect={selection.toggle}
          onNavigate={setPreviewPage}
          onClose={closePreview}
        />
      )}
    </section>
  );
}
