'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine, ArrowUpDown, Loader2, Redo2, RotateCcw, Undo2, Repeat,
} from 'lucide-react';
import {
  dropPages, formatPageOrder, initHistory, isOriginalOrder, movedCount, moveLeft, moveRight, moveToEnd, moveToStart, originalOrder,
  pagesBetween, parsePageOrder, pushOrder, redoOrder, reverseOrder, sameOrder, undoOrder, type OrderHistory, type ReorderRequest,
} from '@/lib/pdf/page-order';
import { PagePreviewDialog } from '../page-preview/PagePreviewDialog';
import { moveGridFocus } from '../page-preview/PageGrid';
import { PdfFileCard, inputClass, secondaryButtonClass as secondaryButton } from '../page-preview/PdfFileCard';
import { MobileActionBar, SubmitPanel } from '../page-preview/SelectionControls';
import { usePdfPreview } from '../page-preview/usePdfPreview';
import { DragPreview, SortablePageTile } from './SortablePageTile';

interface ReorderPagesWorkspaceProps {
  file: File;
  /** True while the upload/job is running: controls are locked and repeat submissions are ignored. */
  busy: boolean;
  onReorder: (request: ReorderRequest) => void;
  onRemoveFile: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    setReduce(query.matches);
    const onChange = () => setReduce(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduce;
}

export function ReorderPagesWorkspace({ file, busy, onReorder, onRemoveFile }: ReorderPagesWorkspaceProps) {
  const ids = useId();
  const preview = usePdfPreview(file);
  const { load, doc, pageCount, thumbnails } = preview;
  const reduceMotion = usePrefersReducedMotion();

  const [history, setHistory] = useState<OrderHistory>(() => initHistory([]));
  const order = history.present;
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const [orderText, setOrderText] = useState('');
  const [editingText, setEditingText] = useState(false);
  const [textTouched, setTextTouched] = useState(false);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const justDragged = useRef(false);
  const gridRef = useRef<HTMLOListElement>(null);

  // A new file (or its page count arriving) starts a fresh arrangement.
  useEffect(() => {
    setHistory(initHistory(originalOrder(pageCount)));
    setSelected(new Set());
    anchor.current = null;
    setOrderText(formatPageOrder(originalOrder(pageCount)));
    setTextTouched(false);
    setPreviewPage(null);
    setAttempted(false);
  }, [file, pageCount]);

  // The Custom Page Order field follows every change that did not come from typing in it; while the
  // user's own text is incomplete or invalid it is left exactly as typed.
  const orderFromText = useRef(false);
  useLayoutEffect(() => {
    if (orderFromText.current) { orderFromText.current = false; return; }
    setOrderText(formatPageOrder(order));
    setTextTouched(false);
  }, [order]);

  const commit = useCallback((next: number[]) => setHistory((h) => pushOrder(h, next)), []);
  const undo = useCallback(() => setHistory(undoOrder), []);
  const redo = useCallback(() => setHistory(redoOrder), []);
  const reset = useCallback(() => commit(originalOrder(pageCount)), [commit, pageCount]);

  // ---- Selection (original page numbers; Shift-click follows the current visual order) ----
  const onActivate = useCallback((page: number, extendRange: boolean) => {
    if (justDragged.current) return;
    setSelected((current) => {
      const next = new Set(current);
      if (extendRange && anchor.current !== null) for (const p of pagesBetween(order, anchor.current, page)) next.add(p);
      else if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
    anchor.current = page;
  }, [order]);

  /** Keep keyboard focus on the first moved page after its tile moves in the DOM. */
  const refocus = useCallback((pages: Set<number>, next: number[]) => {
    const first = next.find((p) => pages.has(p));
    if (first === undefined) return;
    requestAnimationFrame(() => {
      const button = gridRef.current?.querySelector<HTMLElement>(`[data-testid="page-thumb-${first}"]`);
      button?.focus();
      button?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const moveSelection = useCallback((move: (order: readonly number[], pages: Iterable<number>) => number[], keepFocus = false) => {
    if (!selected.size) return;
    const next = move(order, selected);
    commit(next);
    if (keepFocus) refocus(selected, next);
  }, [order, selected, commit, refocus]);

  // ---- Custom Page Order field ----
  const parsed = useMemo(() => parsePageOrder(orderText, pageCount), [orderText, pageCount]);
  const onOrderTextChange = (text: string) => {
    setOrderText(text);
    setTextTouched(true);
    const result = parsePageOrder(text, pageCount);
    if (result.status === 'valid' && !sameOrder(result.order, order)) {
      orderFromText.current = true;
      commit(result.order);
    }
  };
  const onOrderTextBlur = () => {
    setEditingText(false);
    if (parsed.status === 'valid') setOrderText(formatPageOrder(parsed.order));
  };
  const onOrderTextKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOrderText(formatPageOrder(order));
      setTextTouched(false);
    }
  };
  const textError = parsed.status === 'invalid' ? parsed.message : null;
  const textPending = parsed.status === 'incomplete' ? parsed.message : null;

  // ---- Drag and drop ----
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const groupDrag = activePage !== null && selected.has(activePage) && selected.size > 1;
  const onDragStart = useCallback((event: DragStartEvent) => setActivePage(Number(event.active.id)), []);
  const onDragEnd = useCallback((event: DragEndEvent) => {
    setActivePage(null);
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    if (!event.over) return;
    const active = Number(event.active.id);
    const next = dropPages(order, active, Number(event.over.id), selected);
    commit(next);
    if (event.activatorEvent instanceof KeyboardEvent) {
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-testid="drag-handle-${active}"]`)?.focus());
    }
  }, [order, selected, commit]);
  const onDragCancel = useCallback(() => setActivePage(null), []);

  const positionOf = useMemo(() => new Map(order.map((page, index) => [page, index + 1])), [order]);
  const announcements: Announcements = useMemo(() => ({
    onDragStart: ({ active }) => `Picked up page ${active.id}, at position ${positionOf.get(Number(active.id))} of ${pageCount}.`,
    onDragOver: ({ active, over }) => (over ? `Page ${active.id} would move to position ${positionOf.get(Number(over.id))}.` : `Page ${active.id} is not over a position.`),
    onDragEnd: ({ active, over }) => (over ? `Page ${active.id} dropped at position ${positionOf.get(Number(over.id))}.` : `Page ${active.id} dropped. Order unchanged.`),
    onDragCancel: ({ active }) => `Moving page ${active.id} was cancelled. Order unchanged.`,
  }), [positionOf, pageCount]);

  // ---- Keyboard shortcuts (not while typing in a field) ----
  const onWorkspaceKeyDown = (event: React.KeyboardEvent) => {
    if (busy || (event.target as HTMLElement).closest('input, textarea')) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redo(); }
    else if (event.altKey && selected.size) {
      const moves: Record<string, typeof moveLeft> = { ArrowLeft: moveLeft, ArrowRight: moveRight, Home: moveToStart, End: moveToEnd };
      const move = moves[event.key];
      if (move) { event.preventDefault(); moveSelection(move, true); }
    }
  };

  // ---- Plan / submit ----
  const textBlocks = parsed.status !== 'valid' && textTouched;
  const unchanged = isOriginalOrder(order);
  const planError = textBlocks
    ? (textError ?? textPending ?? 'Finish the custom page order.')
    : unchanged ? 'Move at least one page to change the order.' : null;
  const request: ReorderRequest | null = !planError && pageCount > 0 && order.length === pageCount ? { pageOrder: order.slice() } : null;
  const submit = () => {
    setAttempted(true);
    if (request && !busy) onReorder(request);
  };

  const orderSummary = formatPageOrder(order);
  const moved = movedCount(order);
  const closePreview = useCallback(() => setPreviewPage(null), []);
  const toggleFromPreview = useCallback((page: number) => onActivate(page, false), [onActivate]);

  const toolButton = `${secondaryButton} gap-1.5`;
  const moveButtons = (compact: boolean) => (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Move selected pages">
      {([
        ['start', 'To beginning', ArrowLeftToLine, moveToStart],
        ['left', 'Left', ArrowLeft, moveLeft],
        ['right', 'Right', ArrowRight, moveRight],
        ['end', 'To end', ArrowRightToLine, moveToEnd],
      ] as const).map(([id, label, Icon, move]) => (
        <button
          key={id}
          type="button"
          className={`${toolButton} ${compact ? 'min-h-[40px] px-1' : 'flex-col px-1 py-2'}`}
          onClick={() => moveSelection(move)}
          disabled={busy || !selected.size}
          aria-label={`Move selected pages ${id === 'start' ? 'to the beginning' : id === 'end' ? 'to the end' : id}`}
          data-testid={`${compact ? 'mobile-' : ''}move-${id}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {!compact && <span className="text-[11px]">{label}</span>}
        </button>
      ))}
    </div>
  );

  const activeUrl = activePage !== null ? thumbnails.urls[activePage] : undefined;

  return (
    <section aria-label="Reorder PDF pages workspace" className="space-y-5" data-testid="reorder-workspace" onKeyDown={onWorkspaceKeyDown}>
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="reorder" />

      {load.status === 'ready' && order.length === pageCount && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Arrangement grid */}
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">Page order</h3>
              <div className="flex items-center gap-3 text-xs text-ink-500 dark:text-zinc-400" aria-live="polite">
                {thumbnails.pending > 0 && (
                  <span className="inline-flex items-center gap-1.5" data-testid="render-status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rendering previews…
                  </span>
                )}
                <span className="font-semibold text-ink-800 dark:text-zinc-100" data-testid="selected-count">{selected.size} of {pageCount} selected</span>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 font-semibold text-brand-700 dark:text-brand-200">3</span> New position
              </span>
              <span className="inline-flex items-center gap-1.5"><span>Page 5</span> Original page number</span>
              <span className="hidden sm:inline">Drag pages to move them. Select several to move them together.</span>
              <span className="sm:hidden">Press and hold a page, then drag. Or select pages and use the move buttons.</span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
              accessibility={{ announcements, screenReaderInstructions: { draggable: 'To pick up a page, press Space. Use the arrow keys to move it, Space to drop it, or Escape to cancel.' } }}
            >
              <SortableContext items={order} strategy={rectSortingStrategy} disabled={busy}>
                <ol
                  ref={gridRef}
                  className="grid grid-cols-2 gap-3 overflow-x-hidden sm:grid-cols-3 md:grid-cols-4 lg:max-h-[calc(100vh-14rem)] lg:grid-cols-3 lg:overflow-y-auto lg:p-2 xl:grid-cols-4"
                  aria-label={`${pageCount} pages in their new order`}
                  data-testid="page-grid"
                  onKeyDown={(event) => { moveGridFocus(event); }}
                >
                  {order.map((page, index) => (
                    <SortablePageTile
                      key={page}
                      page={page}
                      position={index + 1}
                      url={thumbnails.urls[page]}
                      failed={!!thumbnails.failed[page]}
                      aspectRatio={load.aspectRatio}
                      selected={selected.has(page)}
                      travelling={groupDrag && page !== activePage && selected.has(page)}
                      disabled={busy}
                      reduceMotion={reduceMotion}
                      observe={preview.observe}
                      onActivate={onActivate}
                      onPreview={setPreviewPage}
                    />
                  ))}
                </ol>
              </SortableContext>
              <DragOverlay dropAnimation={reduceMotion ? null : { duration: 180 }}>
                {activePage !== null && (
                  <DragPreview url={activeUrl} failed={!!thumbnails.failed[activePage]} aspectRatio={load.aspectRatio} page={activePage} count={groupDrag ? selected.size : 1} />
                )}
              </DragOverlay>
            </DndContext>

            <MobileActionBar
              tone="brand" icon={ArrowUpDown} busy={busy} disabled={!request} onSubmit={submit}
              text={request ? `${plural(moved, 'page')} moved` : planError} label="Reorder" busyLabel="Reordering…"
              optionsHref="#reorder-options" testIdPrefix="reorder"
              extra={selected.size > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 pl-2 text-xs font-semibold text-ink-700 dark:text-zinc-200">{selected.size} selected</span>
                  <div className="min-w-0 flex-1">{moveButtons(true)}</div>
                </div>
              ) : undefined}
            />
          </div>

          {/* Controls */}
          <aside id="reorder-options" className="scroll-mt-24 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Reorder options">
            <fieldset disabled={busy} className="space-y-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">Arrange</legend>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={toolButton} onClick={undo} disabled={!history.past.length} data-testid="undo" aria-keyshortcuts="Control+Z">
                  <Undo2 className="h-4 w-4" aria-hidden /> Undo
                </button>
                <button type="button" className={toolButton} onClick={redo} disabled={!history.future.length} data-testid="redo" aria-keyshortcuts="Control+Y">
                  <Redo2 className="h-4 w-4" aria-hidden /> Redo
                </button>
                <button type="button" className={toolButton} onClick={reset} disabled={unchanged} data-testid="reset-order">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Reset to original
                </button>
                <button type="button" className={toolButton} onClick={() => commit(reverseOrder(order))} disabled={pageCount < 2} data-testid="reverse-order">
                  <Repeat className="h-4 w-4" aria-hidden /> Reverse order
                </button>
              </div>
            </fieldset>

            <fieldset disabled={busy} className="space-y-2">
              <legend className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">
                Move selected pages
              </legend>
              {moveButtons(false)}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={secondaryButton} onClick={() => setSelected(new Set(order))} disabled={selected.size === pageCount} data-testid="select-all">
                  Select all
                </button>
                <button type="button" className={secondaryButton} onClick={() => { setSelected(new Set()); anchor.current = null; }} disabled={!selected.size} data-testid="clear-selection">
                  Clear selection
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-500 dark:text-zinc-400">
                Keyboard: arrow keys move focus · Alt+arrows move selected pages · Ctrl+Z / Ctrl+Y undo and redo · on a grip, Space picks up and drops.
              </p>
            </fieldset>

            <div>
              <label htmlFor={`${ids}-order`} className="mb-1.5 block text-sm font-semibold text-ink-900 dark:text-white">Custom Page Order</label>
              <input
                id={`${ids}-order`}
                data-testid="order-input"
                value={orderText}
                onChange={(e) => onOrderTextChange(e.target.value)}
                onFocus={() => setEditingText(true)}
                onBlur={onOrderTextBlur}
                onKeyDown={onOrderTextKeyDown}
                disabled={busy}
                placeholder="e.g. 3, 1, 5, 2, 4"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!textError || (!!textPending && textTouched && !editingText)}
                aria-describedby={`${ids}-order-help ${ids}-order-error`}
                className={`${inputClass} ${textError || (textPending && textTouched && !editingText) ? 'border-rose-500 dark:border-rose-500' : ''}`}
              />
              <p id={`${ids}-order-help`} className="mt-1.5 text-xs text-ink-500 dark:text-zinc-400">
                List every original page 1–{pageCount} once, in the order you want. Ranges work: 5, 1-4 or {pageCount}-1. Esc restores the current order.
              </p>
              <p
                id={`${ids}-order-error`}
                aria-live="polite"
                data-testid="order-error"
                className={`mt-1 text-xs font-medium ${textError || (textPending && !editingText && textTouched) ? 'text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-zinc-400'}`}
              >
                {textError ?? (textTouched ? textPending : null) ?? ''}
              </p>
            </div>

            <SubmitPanel
              tone="brand" icon={ArrowUpDown} busy={busy} disabled={!request} onSubmit={submit}
              label="Reorder PDF" busyLabel="Reordering…" testIdPrefix="reorder"
              summary={request ? (
                <span className="block text-ink-700 dark:text-zinc-200">
                  New order: <strong className="break-words text-ink-900 dark:text-white" data-testid="order-summary">{orderSummary.length > 160 ? `${orderSummary.slice(0, 160)}…` : orderSummary}</strong>
                  <span className="mt-0.5 block text-ink-500 dark:text-zinc-400">{plural(moved, 'page')} change position · {plural(pageCount, 'page')} in total</span>
                </span>
              ) : (
                <span className={attempted || textBlocks ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-zinc-400'}>{planError}</span>
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
          sequence={order}
          onToggleSelect={toggleFromPreview}
          onNavigate={setPreviewPage}
          onClose={closePreview}
        />
      )}
    </section>
  );
}
