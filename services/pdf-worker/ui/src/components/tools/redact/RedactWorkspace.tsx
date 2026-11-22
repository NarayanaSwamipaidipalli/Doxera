'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { AlertTriangle, Eraser, Loader2, Minus, Plus, Trash2, X } from 'lucide-react';
import { isRenderCancelled, releaseCanvas, renderPage } from '@/lib/pdf/pdf-document';
import {
  areaToScreen, buildRedactRequest, countWholeWordMatches, dragToArea, redactedFileName, textInArea, ZOOM_LEVELS,
  type RedactionArea, type RedactRequest, type TextBox,
} from '@/lib/pdf/redact';
import { PdfFileCard } from '../page-preview/PdfFileCard';
import { ThumbnailImage } from '../page-preview/PageThumbnail';
import { SubmitPanel } from '../page-preview/SelectionControls';
import { usePdfPreview, type PdfPreview } from '../page-preview/usePdfPreview';

interface RedactWorkspaceProps {
  file: File;
  busy: boolean;
  onRedact: (request: RedactRequest) => void;
  onRemoveFile: () => void;
}

type PageInfo = { width: number; height: number; text: string; boxes: TextBox[] };

function Thumb({ page, preview, active, count, aspect, onSelect }: { page: number; preview: PdfPreview; active: boolean; count: number; aspect: number; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { observe, thumbnails } = preview;
  useEffect(() => (ref.current ? observe(ref.current, page) : undefined), [observe, page]);
  return (
    <button ref={ref} type="button" onClick={onSelect} aria-current={active ? 'page' : undefined} data-testid={`redact-page-${page}`}
      className={`focus-ring relative w-full rounded-lg border p-1 text-left transition-colors ${active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-black/10 hover:border-brand-500/40 dark:border-white/10'}`}>
      <span className="block overflow-hidden rounded bg-white"><ThumbnailImage url={thumbnails.urls[page]} failed={Boolean(thumbnails.failed[page])} aspectRatio={aspect} /></span>
      <span className="mt-1 flex items-center justify-between text-[11px] text-ink-600 dark:text-zinc-300">
        Page {page}
        {count > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{count}</span>}
      </span>
    </button>
  );
}

export function RedactWorkspace({ file, busy, onRedact, onRemoveFile }: RedactWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount } = preview;
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [info, setInfo] = useState<Record<number, PageInfo>>({});
  const [areas, setAreas] = useState<RedactionArea[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState('');
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextId = useRef(1);

  useEffect(() => { setCurrent(1); setAreas([]); setTerms([]); setInfo({}); setConfirming(false); }, [file]);

  // Page size (as displayed) and text runs with their boxes, for every page (used for previews and term counts).
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      for (let n = 1; n <= pageCount && !cancelled; n++) {
        const page: PDFPageProxy = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const boxes: TextBox[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const [a, b, , , e, f] = viewport.transform;
          const m = item.transform;
          // Item origin in displayed points (pdf.js viewport at scale 1), box above the baseline.
          const x = a * m[4] + viewport.transform[2] * m[5] + e;
          const y = b * m[4] + viewport.transform[3] * m[5] + f;
          const height = Math.hypot(m[2], m[3]) || item.height;
          const rotated = Math.abs(viewport.transform[1]) > 0.5;
          boxes.push(rotated
            ? { text: item.str, x: x - height, y: y - (item.width || 0), width: height, height: item.width || 0 }
            : { text: item.str, x, y: y - height, width: item.width || 0, height });
        }
        const pageInfo = { width: viewport.width, height: viewport.height, text: boxes.map((bx) => bx.text).join(' '), boxes };
        page.cleanup();
        if (!cancelled) setInfo((all) => ({ ...all, [n]: pageInfo }));
      }
    })().catch(() => { /* previews only */ });
    return () => { cancelled = true; };
  }, [doc, pageCount]);

  // Render the current page large at the chosen zoom.
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const canvas = canvasRef.current;
    setRendering(true);
    void (async () => {
      const page = await doc.getPage(current);
      if (cancelled) return;
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const context = canvas.getContext('2d');
      if (!context) return;
      const render = renderPage(page, canvas, context, zoom * ratio);
      task = render;
      const viewport = page.getViewport({ scale: zoom });
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await render.promise;
      if (!cancelled) setRendering(false);
    })().catch((error) => { if (!isRenderCancelled(error) && !cancelled) setRendering(false); });
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, current, zoom]);
  useEffect(() => () => releaseCanvas(canvasRef.current), []);

  const pageInfo = info[current];
  const pointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const finishDrag = useCallback(() => {
    if (!drag || !pageInfo) { setDrag(null); return; }
    const area = dragToArea(drag.start, drag.end, zoom, { number: current, width: pageInfo.width, height: pageInfo.height }, `area-${nextId.current++}`);
    if (area) setAreas((all) => [...all, area]);
    setDrag(null);
  }, [drag, zoom, current, pageInfo]);

  const termMatches = useMemo(() => terms.map((term) => ({
    term, count: Object.values(info).reduce((sum, p) => sum + countWholeWordMatches(p.text, term), 0),
  })), [terms, info]);
  const addTerm = () => {
    const term = termInput.trim();
    if (term && term.length <= 200 && !terms.some((t) => t.toLowerCase() === term.toLowerCase())) setTerms((all) => [...all, term]);
    setTermInput('');
  };
  const pageAreas = areas.filter((a) => a.page === current);
  const ready = load.status === 'ready';
  const hasSelection = areas.length > 0 || terms.length > 0;
  const live = drag ? { left: Math.min(drag.start.x, drag.end.x), top: Math.min(drag.start.y, drag.end.y), width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y) } : null;

  const confirm = () => {
    if (!understood || busy) return;
    setConfirming(false);
    setUnderstood(false);
    onRedact(buildRedactRequest(areas, terms));
  };

  return (
    <section aria-label="Redact PDF workspace" className="space-y-5" data-testid="redact-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="redact" />
      {ready && (
        <div className="grid gap-5 lg:grid-cols-[120px_minmax(0,1fr)_320px]">
          <nav aria-label="Pages" className="flex gap-2 overflow-x-auto lg:max-h-[75vh] lg:flex-col lg:overflow-y-auto">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <div key={n} className="w-24 shrink-0 lg:w-full">
                <Thumb page={n} preview={preview} active={n === current} count={areas.filter((a) => a.page === n).length}
                  aspect={info[n] ? info[n].width / info[n].height : load.aspectRatio} onSelect={() => setCurrent(n)} />
              </div>
            ))}
          </nav>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-600 dark:text-zinc-300">Drag over anything you want removed on page {current}. Whole words touched by an area are removed.</p>
              <div className="flex items-center gap-1" role="group" aria-label="Zoom">
                <button type="button" className="focus-ring rounded-lg border border-black/10 p-1.5 disabled:opacity-40 dark:border-white/10" aria-label="Zoom out"
                  disabled={zoom <= ZOOM_LEVELS[0]} onClick={() => setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]) - 1)])}><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-12 text-center text-xs font-semibold text-ink-800 dark:text-zinc-100" data-testid="redact-zoom">{Math.round(zoom * 100)}%</span>
                <button type="button" className="focus-ring rounded-lg border border-black/10 p-1.5 disabled:opacity-40 dark:border-white/10" aria-label="Zoom in"
                  disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} onClick={() => setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]) + 1)])}><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="overflow-auto rounded-xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]" style={{ maxHeight: '75vh' }}>
              <div className="relative mx-auto w-max select-none shadow-md">
                <canvas ref={canvasRef} className="block bg-white" data-testid="redact-canvas" />
                <div
                  className={`absolute inset-0 ${busy ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
                  data-testid="redact-surface"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => { if (busy || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const p = pointer(e); setDrag({ start: p, end: p }); }}
                  onPointerMove={(e) => { if (drag) setDrag({ ...drag, end: pointer(e) }); }}
                  onPointerUp={finishDrag}
                  onPointerCancel={() => setDrag(null)}
                >
                  {pageAreas.map((area) => {
                    const s = areaToScreen(area, zoom);
                    return (
                      <div key={area.id} className="absolute border-2 border-rose-500 bg-black/80" style={s} data-testid="redact-area">
                        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setAreas((all) => all.filter((a) => a.id !== area.id))}
                          className="focus-ring absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white shadow" aria-label="Remove this area">
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                    );
                  })}
                  {live && <div className="absolute border-2 border-dashed border-rose-500 bg-rose-500/20" style={live} />}
                </div>
                {rendering && <div className="absolute inset-0 flex items-center justify-center bg-white/40"><Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden /></div>}
              </div>
            </div>
          </div>

          <aside className="space-y-4" aria-label="Redaction selections">
            <div>
              <label htmlFor="redact-term" className="mb-1 block text-xs font-semibold text-ink-700 dark:text-zinc-200">Find text on every page</label>
              <div className="flex gap-2">
                <input id="redact-term" data-testid="redact-term" value={termInput} disabled={busy} autoComplete="off" spellCheck={false} maxLength={200}
                  onChange={(e) => setTermInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTerm(); } }}
                  placeholder="e.g. QA-LOCK-739152" className="focus-ring w-full min-w-0 rounded-xl border px-3 py-2 text-base sm:text-sm" />
                <button type="button" onClick={addTerm} disabled={busy || !termInput.trim()} className="focus-ring shrink-0 rounded-xl bg-brand-600 px-3 text-xs font-semibold text-white disabled:opacity-50" data-testid="redact-term-add">Add</button>
              </div>
              <p className="mt-1 text-xs text-ink-500 dark:text-zinc-400">Matches whole words only. Text inside images can&apos;t be found: draw an area over it instead.</p>
              {termMatches.length > 0 && (
                <ul className="mt-2 space-y-1" data-testid="redact-terms">
                  {termMatches.map(({ term, count }) => (
                    <li key={term} className="flex items-center justify-between gap-2 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs dark:border-white/10">
                      <span className="min-w-0 break-all font-medium text-ink-900 dark:text-white">{term}</span>
                      <span className={`shrink-0 ${count ? 'text-ink-500 dark:text-zinc-400' : 'font-medium text-amber-600 dark:text-amber-400'}`}>{count ? `${count} match${count === 1 ? '' : 'es'}` : 'not found in text'}</span>
                      <button type="button" onClick={() => setTerms((all) => all.filter((t) => t !== term))} className="focus-ring shrink-0 rounded p-1 text-ink-500 hover:text-rose-600" aria-label={`Remove ${term}`}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold text-ink-700 dark:text-zinc-200">Areas ({areas.length})</h3>
              {areas.length === 0 ? (
                <p className="text-xs text-ink-500 dark:text-zinc-400">No areas yet.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto" data-testid="redact-area-list">
                  {areas.map((area) => {
                    const covered = info[area.page] ? textInArea(info[area.page].boxes, area) : '';
                    return (
                      <li key={area.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs dark:border-white/10">
                        <button type="button" className="min-w-0 text-left" onClick={() => setCurrent(area.page)}>
                          <span className="block font-medium text-ink-900 dark:text-white">Page {area.page}</span>
                          <span className="block break-all text-ink-500 dark:text-zinc-400">{covered ? `Text: ${covered}` : 'Image or graphics area'}</span>
                        </button>
                        <button type="button" onClick={() => setAreas((all) => all.filter((a) => a.id !== area.id))} className="focus-ring shrink-0 rounded p-1 text-ink-500 hover:text-rose-600" aria-label={`Remove area on page ${area.page}`}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Redaction permanently deletes the selected text and image pixels from the downloaded PDF. It can&apos;t be undone in that file; your original upload is not changed.</span>
            </div>
            <SubmitPanel tone="rose" icon={Eraser} busy={busy} disabled={!hasSelection} onSubmit={() => setConfirming(true)}
              label="Redact PDF" busyLabel="Redacting…" testIdPrefix="redact"
              summary={hasSelection
                ? <span className="text-ink-700 dark:text-zinc-200">{areas.length} area{areas.length === 1 ? '' : 's'} and {terms.length} search term{terms.length === 1 ? '' : 's'}. You will get {redactedFileName(file.name)}.</span>
                : <span className="text-ink-500 dark:text-zinc-400">Draw an area or add a search term to continue.</span>} />
          </aside>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="redact-confirm-title" data-testid="redact-confirm">
          <div className="w-full max-w-md rounded-2xl border border-black/10 bg-[var(--elevated)] p-5 shadow-xl dark:border-white/10">
            <h2 id="redact-confirm-title" className="text-base font-semibold text-ink-900 dark:text-white">Permanently redact?</h2>
            <p className="mt-2 text-sm text-ink-700 dark:text-zinc-300">
              {areas.length} area{areas.length === 1 ? '' : 's'} and every whole-word match of {terms.length} search term{terms.length === 1 ? '' : 's'} will be removed from the downloaded PDF. The removed text and image pixels can&apos;t be recovered from that file.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-ink-800 dark:text-zinc-200">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-rose-600" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="redact-understood" autoFocus />
              I understand this can&apos;t be undone in the redacted file.
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setConfirming(false); setUnderstood(false); }} className="focus-ring rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-ink-800 dark:border-white/10 dark:text-zinc-100">Cancel</button>
              <button type="button" onClick={confirm} disabled={!understood} className="focus-ring rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" data-testid="redact-confirm-button">Redact permanently</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
