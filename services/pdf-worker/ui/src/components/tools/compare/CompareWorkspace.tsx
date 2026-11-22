'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfPreview } from '../page-preview/usePdfPreview';
import { isRenderCancelled, releaseCanvas, renderPage } from '@/lib/pdf/pdf-document';
import { changeColors, changeLabel, filterDifferences, type ComparisonSummary, type PdfDifference } from '@/lib/pdf/compare';

const control = 'focus-ring rounded-lg border border-black/15 px-3 py-2 text-xs disabled:opacity-40 dark:border-white/20';

function ComparedPage({ doc, pageNumber, side, changes, zoom, scrollRef, onScroll }: {
  doc: PDFDocumentProxy | null; pageNumber: number | null; side: 'original' | 'modified'; changes: PdfDifference[];
  zoom: number; scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(400);
  const [size, setSize] = useState({ width: 595, height: 842 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(100, entry.contentRect.width - 24)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !pageNumber || !canvas.current) return;
    const element = canvas.current;
    let stopped = false;
    let task: ReturnType<typeof renderPage> | null = null;
    setLoading(true); setError('');
    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (stopped) return;
      const viewport = page.getViewport({ scale: 1 });
      setSize({ width: viewport.width, height: viewport.height });
      const scale = width / viewport.width * zoom;
      const context = element.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      task = renderPage(page, element, context, scale * Math.min(window.devicePixelRatio || 1, 2));
      element.style.width = `${viewport.width * scale}px`;
      element.style.height = `${viewport.height * scale}px`;
      await task.promise;
      if (!stopped) setLoading(false);
    })().catch(e => { if (!stopped && !isRenderCancelled(e)) { setError('This page could not be rendered. Try another page or download the report.'); setLoading(false); } });
    return () => { stopped = true; task?.cancel(); };
  }, [doc, pageNumber, width, zoom]);
  useEffect(() => { const element = canvas.current; return () => releaseCanvas(element); }, []);
  const regions = changes.flatMap(change => change[`${side}Regions`].filter(r => r.page === pageNumber).map(r => ({ ...r, change })));
  return <div ref={host} className="min-w-0">
    <div ref={scrollRef} onScroll={onScroll} className="max-h-[65vh] overflow-auto rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/15 dark:bg-white/5" data-testid={`compare-${side}-scroll`}>
      {pageNumber && doc ? <div data-page-height={size.height} className="relative mx-auto bg-white shadow" style={{ width: width * zoom, minHeight: width * zoom * size.height / size.width }}>
        <canvas ref={canvas} className="block" data-testid={`compare-${side}-canvas`} aria-label={`${side} PDF page ${pageNumber}`} />
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {regions.map((r, i) => <div key={`${r.change.id}-${i}`} data-testid="compare-highlight" className="absolute border-2"
            title={`#${r.change.id} ${changeLabel(r.change.type)}`} style={{ left: `${r.box[0] / size.width * 100}%`, top: `${r.box[1] / size.height * 100}%`,
              width: `${(r.box[2] - r.box[0]) / size.width * 100}%`, height: `${(r.box[3] - r.box[1]) / size.height * 100}%`,
              borderColor: changeColors[r.change.type], backgroundColor: `${changeColors[r.change.type]}30` }} />)}
        </div>
      </div> : <p className="py-20 text-center text-sm">{doc ? 'No corresponding page' : 'Loading PDF preview…'}</p>}
    </div>
    {loading && <p role="status" className="mt-1 text-xs">Rendering page…</p>}
    {error && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
  </div>;
}

export function CompareWorkspace({ original, modified, summary, busy, canCancel, onCompare, onCancel, onDownload, onReset }: {
  original: File; modified: File; summary: ComparisonSummary | null; busy: boolean; canCancel: boolean;
  onCompare: () => void; onCancel: () => void; onDownload: () => void; onReset: () => void;
}) {
  const left = usePdfPreview(original), right = usePdfPreview(modified);
  const [pairIndex, setPairIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [mobileSide, setMobileSide] = useState<'original' | 'modified'>('original');
  const [filter, setFilter] = useState<'all' | 'text' | 'visual'>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [sync, setSync] = useState(true);
  const leftScroll = useRef<HTMLDivElement>(null), rightScroll = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  useEffect(() => { setPairIndex(0); setSelected(null); setShowAll(true); }, [original, modified, summary]);
  const pairs = useMemo(() => summary?.pageMap || Array.from({ length: Math.max(left.pageCount, right.pageCount) }, (_, i) => ({
    originalPage: i < left.pageCount ? i + 1 : null, modifiedPage: i < right.pageCount ? i + 1 : null, changed: false,
  })), [summary, left.pageCount, right.pageCount]);
  const pair = pairs[Math.min(pairIndex, Math.max(0, pairs.length - 1))];
  const changes = useMemo(() => filterDifferences(summary?.differences || [], filter), [summary, filter]);
  const visibleChanges = showAll ? changes : changes.filter(d => d.id === selected);
  const selectedIndex = changes.findIndex(d => d.id === selected);
  const choose = (difference: PdfDifference) => {
    setSelected(difference.id); setShowAll(false);
    const i = pairs.findIndex(p => (difference.originalPage && p.originalPage === difference.originalPage) || (difference.modifiedPage && p.modifiedPage === difference.modifiedPage));
    if (i >= 0) setPairIndex(i);
    const region = (mobileSide === 'original' ? difference.originalRegions : difference.modifiedRegions)[0];
    if (!region) setMobileSide(difference.originalRegions.length ? 'original' : 'modified');
  };
  // Move both viewers to the exact selected area after their page layout updates.
  useEffect(() => {
    if (showAll || selected === null || !summary) return;
    const d = summary.differences.find(c => c.id === selected);
    const timer = window.setTimeout(() => {
      for (const [side, ref] of [['original', leftScroll], ['modified', rightScroll]] as const) {
        const r = d?.[`${side}Regions`][0], el = ref.current;
        const surface = el?.querySelector<HTMLElement>('[data-page-height]');
        if (r && el && surface) {
          el.scrollTop = Math.max(0, r.box[1] / Number(surface.dataset.pageHeight) * surface.getBoundingClientRect().height - el.clientHeight / 3);
          el.scrollLeft = Math.max(0, r.box[0] / Number(surface.dataset.pageHeight) * surface.getBoundingClientRect().height - el.clientWidth / 3);
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [selected, showAll, summary, pairIndex, mobileSide, zoom]);
  const synchronize = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!sync || !from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight) * (to.scrollHeight - to.clientHeight);
    to.scrollLeft = from.scrollLeft / Math.max(1, from.scrollWidth - from.clientWidth) * (to.scrollWidth - to.clientWidth);
    requestAnimationFrame(() => { syncing.current = false; });
  };
  const ready = left.load.status === 'ready' && right.load.status === 'ready';
  return <section aria-label="Compare PDF workspace" className="min-w-0 space-y-5 text-ink-800 dark:text-zinc-100" data-testid="compare-workspace">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">Compare words, images and page layout. Original is on the left; modified is on the right.</p>
      <button type="button" className={control} disabled={busy} onClick={onReset}>Choose different files</button>
    </div>
    {left.load.status === 'error' && <p role="alert">Original: {left.load.message}</p>}
    {right.load.status === 'error' && <p role="alert">Modified: {right.load.message}</p>}
    {summary && <>
      <dl className="grid grid-cols-2 gap-2 rounded-xl bg-black/5 p-4 text-sm sm:grid-cols-4 dark:bg-white/5" data-testid="compare-summary">
        {([['Differences', summary.totalDifferences], ['Pages changed', summary.pagesChanged], ['Pages added', summary.pagesAdded], ['Pages removed', summary.pagesRemoved],
          ['Text changes', summary.textChanges], ['Visual changes', summary.visualChanges], ['Pages moved', summary.pagesMoved]] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-ink-600 dark:text-zinc-300">{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}
      </dl>
      {summary.totalDifferences === 0 && <p role="status">No differences detected within the documented visual tolerances.</p>}
      {summary.detailsTruncated && <p role="status" className="text-sm">The on-screen change list is limited. Download the report for all {summary.totalDifferences} differences and the embedded comparison.json file.</p>}
    </>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={control} disabled={!pairs.length || pairIndex === 0} onClick={() => setPairIndex(i => i - 1)}>Previous page</button>
      <label className="text-xs">Page pair <select aria-label="Page pair" className={`${control} ml-1 max-w-44 bg-white text-ink-900 dark:bg-zinc-900 dark:text-white`} value={pairIndex} onChange={e => setPairIndex(Number(e.target.value))}>
        {pairs.map((p, i) => <option key={i} value={i}>{p.originalPage || '—'} / {p.modifiedPage || '—'}{p.changed ? ' · changed' : ''}</option>)}
      </select></label>
      <button type="button" className={control} disabled={!pairs.length || pairIndex >= pairs.length - 1} onClick={() => setPairIndex(i => i + 1)}>Next page</button>
      <button type="button" className={control} aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(z => z - 0.25)}>−</button>
      <span className="text-xs" data-testid="compare-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" className={control} aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(z => z + 0.25)}>+</button>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />Sync scrolling</label>
    </div>
    <div className="flex gap-2 lg:hidden" role="group" aria-label="Document view">
      {(['original', 'modified'] as const).map(side => <button key={side} type="button" className={`${control} capitalize`} aria-pressed={mobileSide === side} onClick={() => setMobileSide(side)}>{side}</button>)}
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      {(['original', 'modified'] as const).map(side => {
        const preview = side === 'original' ? left : right;
        return <div key={side} className={`min-w-0 ${mobileSide === side ? '' : 'hidden lg:block'}`}>
          <h3 className="mb-1 text-sm font-semibold capitalize">{side} · page {pair?.[`${side}Page`] || '—'} of {preview.pageCount || '…'}</h3>
          <p className="mb-2 truncate text-xs text-ink-600 dark:text-zinc-300" title={(side === 'original' ? original : modified).name}>{(side === 'original' ? original : modified).name}</p>
          <ComparedPage doc={preview.doc} pageNumber={pair?.[`${side}Page`] ?? null} side={side} zoom={zoom} changes={visibleChanges}
            scrollRef={side === 'original' ? leftScroll : rightScroll} onScroll={() => side === 'original' ? synchronize(leftScroll.current, rightScroll.current) : synchronize(rightScroll.current, leftScroll.current)} />
        </div>;
      })}
    </div>
    {summary && <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Difference navigation">
        <button type="button" className={control} disabled={!changes.length} onClick={() => choose(changes[selectedIndex < 0 ? changes.length - 1 : (selectedIndex - 1 + changes.length) % changes.length])}>Previous Difference</button>
        <button type="button" className={control} disabled={!changes.length} onClick={() => choose(changes[(selectedIndex + 1) % changes.length])}>Next Difference</button>
        <button type="button" className={control} aria-pressed={showAll && filter === 'all'} onClick={() => { setFilter('all'); setShowAll(true); setSelected(null); }}>Show All Differences</button>
        {(['text', 'visual'] as const).map(f => <button key={f} type="button" className={control} aria-pressed={filter === f} onClick={() => { setFilter(f); setShowAll(true); setSelected(null); }}>{f === 'text' ? 'Text Changes' : 'Visual Changes'}</button>)}
      </div>
      <p role="status" className="text-xs">{selected ? `Difference #${selected} selected. ` : ''}{changes.length} changes in this list. Green: added; red: removed; amber: modified or visual.</p>
      <ol className="max-h-80 space-y-2 overflow-y-auto" aria-label="Changes">
        {changes.map(d => <li key={d.id}><button type="button" className={`${control} w-full break-words text-left ${selected === d.id ? 'ring-2 ring-brand-500' : ''}`} onClick={() => choose(d)} aria-pressed={selected === d.id}>
          <span className="font-semibold">#{d.id} {changeLabel(d.type)} · Original p.{d.originalPage || '—'} → Modified p.{d.modifiedPage || '—'}</span>
          {d.before !== null && <span className="mt-1 block whitespace-pre-wrap text-rose-700 dark:text-rose-300">Before: {d.before}</span>}
          {d.after !== null && <span className="mt-1 block whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">After: {d.after}</span>}
          {d.description && <span className="mt-1 block">{d.description}</span>}
        </button></li>)}
      </ol>
      <details className="text-xs"><summary className="cursor-pointer py-2">Processing notes and limitations</summary><ul className="list-disc space-y-1 pl-5">{summary.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
    </div>}
    <div className="flex flex-wrap gap-3">
      {!summary && <button type="button" className="focus-ring rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={!ready || busy} onClick={onCompare}>{busy ? 'Comparing…' : 'Compare PDFs'}</button>}
      {busy && canCancel && <button type="button" className={control} onClick={onCancel}>Cancel comparison</button>}
      {summary && <button type="button" className="focus-ring rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white" onClick={onDownload}>Download Report</button>}
    </div>
  </section>;
}
