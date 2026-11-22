'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { allExceptFirst, buildDeletePlan, invertSelection, type DeletePagesRequest } from '@/lib/pdf/delete-selection';
import { PagePreviewDialog } from '../page-preview/PagePreviewDialog';
import { PageGrid } from '../page-preview/PageGrid';
import { PdfFileCard, secondaryButtonClass as secondaryButton } from '../page-preview/PdfFileCard';
import { MobileActionBar, PageSpecField, RangePicker, SubmitPanel } from '../page-preview/SelectionControls';
import { usePageSelection } from '../page-preview/usePageSelection';
import { usePdfPreview } from '../page-preview/usePdfPreview';

interface DeletePagesWorkspaceProps {
  file: File;
  /** True while the upload/job is running: controls are locked. */
  busy: boolean;
  onDelete: (request: DeletePagesRequest) => void;
  onRemoveFile: () => void;
}

type View = 'all' | 'remaining';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DeletePagesWorkspace({ file, busy, onDelete, onRemoveFile }: DeletePagesWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount, thumbnails } = preview;
  const selection = usePageSelection(pageCount, file);
  const { selected } = selection;
  const [view, setView] = useState<View>('all');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    setView('all');
    setPreviewPage(null);
    setConfirming(false);
    setAttempted(false);
  }, [file]);

  const closePreview = useCallback(() => setPreviewPage(null), []);
  const isSelected = useCallback((page: number) => selected.has(page), [selected]);

  // ---- Plan / confirm / submit ----
  const plan = useMemo(() => buildDeletePlan(pageCount, selected, selection.inputError), [pageCount, selected, selection.inputError]);
  const keptPages = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i + 1).filter((page) => !selected.has(page)),
    [pageCount, selected],
  );
  const newPosition = useMemo(() => new Map(keptPages.map((page, index) => [page, index + 1])), [keptPages]);
  const captionFor = useCallback((page: number) => (view === 'remaining' && newPosition.get(page) ? `New page ${newPosition.get(page)}` : undefined), [view, newPosition]);
  const pagesInView = useMemo(
    () => (view === 'remaining' ? keptPages : Array.from({ length: pageCount }, (_, i) => i + 1)),
    [view, keptPages, pageCount],
  );

  const requestDelete = () => {
    setAttempted(true);
    if (plan.request && !busy) setConfirming(true);
  };
  const confirmDelete = () => {
    setConfirming(false);
    if (plan.request && !busy) onDelete(plan.request);
  };

  const summary = plan.request
    ? `${plural(plan.deleting.length, 'page')} will be deleted, ${plural(plan.remaining.length, 'page')} will remain.`
    : null;

  const viewButton = (id: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(id)}
      aria-pressed={view === id}
      data-testid={`view-${id}`}
      className={`focus-ring min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors ${
        view === id ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-ink-600 hover:text-ink-900 dark:text-zinc-400 dark:hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section aria-label="Delete PDF pages workspace" className="space-y-5" data-testid="delete-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="delete" />

      {load.status === 'ready' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Page grid */}
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-black/[0.05] p-1 dark:bg-white/[0.06]" role="group" aria-label="Pages shown">
                {viewButton('all', 'All pages')}
                {viewButton('remaining', 'Pages remaining')}
              </div>
              {thumbnails.pending > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-zinc-400" data-testid="render-status" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rendering previews…
                </span>
              )}
            </div>

            <dl className="mb-3 grid grid-cols-3 gap-2 text-center" data-testid="delete-stats" aria-live="polite">
              <div className="rounded-xl border border-black/[0.07] px-2 py-2 dark:border-white/[0.07]">
                <dt className="text-[11px] text-ink-500 dark:text-zinc-400">Original</dt>
                <dd className="text-base font-semibold tabular-nums text-ink-900 dark:text-white" data-testid="stat-original">{pageCount}</dd>
              </div>
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-2 py-2">
                <dt className="text-[11px] text-rose-700 dark:text-rose-300">Deleting</dt>
                <dd className="text-base font-semibold tabular-nums text-rose-700 dark:text-rose-300" data-testid="stat-deleting">{selected.size}</dd>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-2">
                <dt className="text-[11px] text-emerald-700 dark:text-emerald-300">Remaining</dt>
                <dd className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-300" data-testid="stat-remaining">{keptPages.length}</dd>
              </div>
            </dl>

            <p className="mb-3 text-xs text-ink-500 dark:text-zinc-400">
              {view === 'all' ? (
                <>
                  Tap the pages you want to <strong className="text-rose-600 dark:text-rose-400">remove</strong>; they turn red.{' '}
                  <span className="hidden sm:inline">Shift-click marks every page in between. </span>Use the magnifier to enlarge a page.
                </>
              ) : (
                'These pages will be in your new PDF, in this order. Tap a page here to delete it too.'
              )}
            </p>

            {pagesInView.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-rose-500/40 p-8 text-center text-sm text-rose-700 dark:text-rose-300" data-testid="no-pages-remaining">
                No pages would remain. Keep at least one page.
              </div>
            ) : (
              <PageGrid
                pages={pagesInView}
                preview={preview}
                aspectRatio={load.aspectRatio}
                label={view === 'all' ? `${pageCount} pages` : `${pagesInView.length} remaining pages`}
                isSelected={isSelected}
                selectable
                disabled={busy}
                tone="remove"
                captionFor={captionFor}
                onActivate={selection.activate}
                onPreview={setPreviewPage}
              />
            )}

            <MobileActionBar
              tone="rose" icon={Trash2} busy={busy} disabled={!plan.request} onSubmit={requestDelete}
              text={plan.request ? `Delete ${plural(plan.deleting.length, 'page')}` : plan.error}
              label="Delete" busyLabel="Deleting…" optionsHref="#delete-options" testIdPrefix="delete"
            />
          </div>

          {/* Controls */}
          <aside id="delete-options" className="scroll-mt-24 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Delete options">
            <div className="flex gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 text-xs leading-relaxed text-rose-800 dark:text-rose-200">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                You are choosing pages to <strong>remove</strong>. Every page you don&apos;t mark stays in the new PDF. Your original file is not changed.
              </span>
            </div>

            <fieldset disabled={busy} className="space-y-4">
              <PageSpecField
                selection={selection} pageCount={pageCount} label="Pages to Delete" placeholder="e.g. 2, 5, 8-12"
                help="Separate pages with commas and use a dash for ranges." testId="delete-spec-input" errorTestId="delete-spec-error"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`${secondaryButton} col-span-2`}
                  onClick={() => selection.apply(allExceptFirst(pageCount))}
                  disabled={pageCount < 2}
                  data-testid="select-all-but-first"
                >
                  Select all except page 1
                </button>
                <button type="button" className={secondaryButton} onClick={() => selection.apply(invertSelection(selected, pageCount))} data-testid="invert-selection">
                  Invert selection
                </button>
                <button type="button" className={secondaryButton} onClick={selection.clear} disabled={selected.size === 0 && !selection.specText} data-testid="clear-selection">
                  Clear selection
                </button>
              </div>

              <RangePicker
                pageCount={pageCount} title="Mark a range for deletion" applyLabel="Mark" fromLabel="First page to delete" toLabel="Last page to delete"
                onApply={selection.addRange}
              />
            </fieldset>

            <SubmitPanel
              tone="rose" icon={Trash2} busy={busy} disabled={!plan.request} onSubmit={requestDelete}
              label="Delete Selected Pages" busyLabel="Deleting pages…" testIdPrefix="delete"
              summary={summary ? (
                <span className="text-ink-700 dark:text-zinc-200">{summary}</span>
              ) : (
                <span className={attempted || plan.deleting.length >= pageCount ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-zinc-400'}>{plan.error}</span>
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
          tone="remove"
          onToggleSelect={selection.toggle}
          onNavigate={setPreviewPage}
          onClose={closePreview}
        />
      )}

      {confirming && plan.request && (
        <ConfirmDeleteDialog
          deletingSpec={plan.request.pagesToDelete}
          deletingCount={plan.deleting.length}
          remainingCount={plan.remaining.length}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}

interface ConfirmDeleteDialogProps {
  deletingSpec: string;
  deletingCount: number;
  remainingCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDeleteDialog({ deletingSpec, deletingCount, remainingCount, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-ink-950/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="delete-confirm"
        className="w-full max-w-md rounded-2xl border border-black/10 bg-[var(--elevated)] p-5 shadow-2xl dark:border-white/10"
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <h2 id={titleId} className="text-base font-semibold text-ink-900 dark:text-white">
            Delete {plural(deletingCount, 'page')}?
          </h2>
        </div>
        <div id={descriptionId} className="space-y-2 text-sm text-ink-700 dark:text-zinc-300">
          <p>
            {deletingCount === 1 ? 'Page' : 'Pages'}{' '}
            <strong className="break-words text-rose-700 dark:text-rose-300" data-testid="delete-confirm-pages">{deletingSpec}</strong>{' '}
            will be removed.
          </p>
          <p>
            Your new PDF will have <strong className="text-ink-900 dark:text-white" data-testid="delete-confirm-remaining">{plural(remainingCount, 'page')}</strong>, in their original order.
            Your original file is not changed.
          </p>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="focus-ring min-h-[44px] rounded-full border border-black/10 px-5 text-sm font-semibold text-ink-700 hover:bg-black/[0.04] dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
            data-testid="delete-confirm-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="focus-ring flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-500"
            data-testid="delete-confirm-submit"
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete pages
          </button>
        </div>
      </div>
    </div>
  );
}
