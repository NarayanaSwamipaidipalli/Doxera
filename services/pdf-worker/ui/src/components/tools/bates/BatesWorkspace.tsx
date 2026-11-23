'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Loader2 } from 'lucide-react';
import {
  BATES_POSITIONS, batesFileName, batesLabel, batesLayout, DEFAULT_BATES, validateBates,
  type BatesField, type BatesPosition, type BatesRequest,
} from '@/lib/pdf/bates';
import { PdfFileCard } from '../page-preview/PdfFileCard';
import { ThumbnailImage } from '../page-preview/PageThumbnail';
import { SubmitPanel } from '../page-preview/SelectionControls';
import { usePdfPreview, type PdfPreview } from '../page-preview/usePdfPreview';

interface BatesWorkspaceProps {
  file: File;
  busy: boolean;
  onApply: (request: BatesRequest) => void;
  onRemoveFile: () => void;
}

type PageSize = { width: number; height: number };
const POSITION_LABELS: Record<BatesPosition, string> = {
  'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right',
  'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right',
};
const fieldClass = 'focus-ring w-full rounded-xl border px-3 py-2 text-base sm:text-sm';
const labelClass = 'mb-1 block text-xs font-semibold text-ink-700 dark:text-zinc-200';
const MAX_SIZE_SCAN = 3000;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {children}
      {(error || hint) && (
        <p id={`${id}-note`} aria-live="polite" className={`mt-1 text-xs ${error ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-zinc-400'}`} data-testid={`${id}-note`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** One page: the real thumbnail with this page's label drawn where the worker will stamp it. */
function BatesTile({ page, size, label, request, preview }: { page: number; size: PageSize; label: string | null; request: BatesRequest; preview: PdfPreview }) {
  const ref = useRef<HTMLDivElement>(null);
  const { observe, thumbnails } = preview;
  useEffect(() => (ref.current ? observe(ref.current, page) : undefined), [observe, page]);
  const box = label ? batesLayout(label, request.fontSize, size.width, size.height, request.position, request.margin) : null;
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div ref={ref} className="min-w-0" data-testid={`bates-thumb-${page}`}>
      <div className="relative overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/10" style={{ containerType: 'inline-size' }}>
        <ThumbnailImage url={thumbnails.urls[page]} failed={Boolean(thumbnails.failed[page])} aspectRatio={size.width / size.height} dimmed={!label} />
        {box && label && (
          <span
            data-testid={`bates-label-${page}`}
            className="absolute flex items-center whitespace-nowrap leading-none"
            style={{
              left: pct(box.x, size.width), top: pct(box.y, size.height), width: pct(box.width, size.width), height: pct(box.height, size.height),
              paddingLeft: `${(box.padding / size.width) * 100}cqw`, fontSize: `${(box.fontSize / size.width) * 100}cqw`,
              fontFamily: 'Helvetica, Arial, sans-serif', color: request.color, background: request.background ? '#ffffff' : 'transparent',
            }}
          >
            {label}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
        <span className="text-ink-500 dark:text-zinc-400">Page {page}</span>
        <span className={`truncate font-medium ${label ? 'text-ink-800 dark:text-zinc-100' : 'text-ink-400 dark:text-zinc-500'}`}>{label ?? 'Not numbered'}</span>
      </div>
    </div>
  );
}

export function BatesWorkspace({ file, busy, onApply, onRemoveFile }: BatesWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount, thumbnails } = preview;
  const [request, setRequest] = useState<BatesRequest>(DEFAULT_BATES);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => { setRequest(DEFAULT_BATES); setAttempted(false); }, [file]);

  // Page sizes as displayed (pdf.js applies /Rotate), the same sizes the worker lays labels out on.
  useEffect(() => {
    setSizes(null);
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      const list: PageSize[] = [];
      for (let n = 1; n <= Math.min(pageCount, MAX_SIZE_SCAN) && !cancelled; n++) {
        const page = await doc.getPage(n);
        const { width, height } = page.getViewport({ scale: 1 });
        list.push({ width, height });
        page.cleanup();
      }
      if (!cancelled) setSizes(list);
    })().catch(() => { if (!cancelled) setSizes([]); });
    return () => { cancelled = true; };
  }, [doc, pageCount]);

  const { errors, pages } = useMemo(() => validateBates(request, pageCount), [request, pageCount]);
  const labels = useMemo(() => {
    const map = new Map<number, string>();
    pages.forEach((page, index) => map.set(page, batesLabel(request, index)));
    return map;
  }, [pages, request]);
  const valid = Object.keys(errors).length === 0 && pages.length > 0;
  const shown = (field: BatesField) => errors[field];
  const set = <K extends keyof BatesRequest>(key: K, value: BatesRequest[K]) => setRequest((current) => ({ ...current, [key]: value }));
  const number = (key: 'startNumber' | 'padding' | 'increment' | 'fontSize' | 'margin') => (event: React.ChangeEvent<HTMLInputElement>) =>
    set(key, event.target.value === '' ? Number.NaN : Number(event.target.value));
  const describe = (id: string, field: BatesField) => (errors[field] ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-note` } : {});

  const submit = () => {
    if (busy || load.status !== 'ready') return;
    if (!valid) { setAttempted(true); return; }
    onApply({ ...request, prefix: request.prefix, pages: request.pages.trim() });
  };

  const first = pages.length ? labels.get(pages[0]) : null;
  const last = pages.length ? labels.get(pages[pages.length - 1]) : null;

  return (
    <section aria-label="Bates numbering workspace" className="space-y-5" data-testid="bates-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="bates" />
      {load.status === 'ready' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">Preview</h3>
              <div className="flex items-center gap-3 text-xs text-ink-500 dark:text-zinc-400" aria-live="polite">
                {thumbnails.pending > 0 && <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rendering previews…</span>}
                <span className="font-semibold text-ink-800 dark:text-zinc-100" data-testid="bates-page-count">{pageCount} page{pageCount === 1 ? '' : 's'}</span>
              </div>
            </div>
            <p className="mb-3 text-xs text-ink-500 dark:text-zinc-400">Each preview shows that page&apos;s number where it will be stamped, at the chosen size and colour.</p>
            {sizes === null ? (
              <div className="flex items-center gap-2 text-sm text-ink-500 dark:text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading page sizes…</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="bates-grid">
                {Array.from({ length: Math.min(pageCount, sizes.length) }, (_, i) => i + 1).map((page) => (
                  <BatesTile key={page} page={page} size={sizes[page - 1]} label={labels.get(page) ?? null} request={request} preview={preview} />
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start" aria-label="Bates settings">
            <div className="grid grid-cols-2 gap-3">
              <Field id="bates-prefix" label="Prefix" error={shown('prefix')}>
                <input id="bates-prefix" data-testid="bates-prefix" className={fieldClass} value={request.prefix} maxLength={60} disabled={busy}
                  onChange={(e) => set('prefix', e.target.value)} autoComplete="off" spellCheck={false} {...describe('bates-prefix', 'prefix')} />
              </Field>
              <Field id="bates-suffix" label="Suffix (optional)" error={shown('suffix')}>
                <input id="bates-suffix" data-testid="bates-suffix" className={fieldClass} value={request.suffix} maxLength={60} disabled={busy}
                  onChange={(e) => set('suffix', e.target.value)} autoComplete="off" spellCheck={false} {...describe('bates-suffix', 'suffix')} />
              </Field>
              <Field id="bates-start" label="Starting number" error={shown('startNumber')}>
                <input id="bates-start" data-testid="bates-start" type="number" inputMode="numeric" min={0} className={fieldClass} disabled={busy}
                  value={Number.isNaN(request.startNumber) ? '' : request.startNumber} onChange={number('startNumber')} {...describe('bates-start', 'startNumber')} />
              </Field>
              <Field id="bates-padding" label="Digits (padding)" error={shown('padding')}>
                <input id="bates-padding" data-testid="bates-padding" type="number" inputMode="numeric" min={0} max={12} className={fieldClass} disabled={busy}
                  value={Number.isNaN(request.padding) ? '' : request.padding} onChange={number('padding')} {...describe('bates-padding', 'padding')} />
              </Field>
              <Field id="bates-increment" label="Increment" error={shown('increment')}>
                <input id="bates-increment" data-testid="bates-increment" type="number" inputMode="numeric" min={1} max={1000} className={fieldClass} disabled={busy}
                  value={Number.isNaN(request.increment) ? '' : request.increment} onChange={number('increment')} {...describe('bates-increment', 'increment')} />
              </Field>
              <Field id="bates-size" label="Font size (pt)" error={shown('fontSize')}>
                <input id="bates-size" data-testid="bates-size" type="number" min={6} max={36} step={0.5} className={fieldClass} disabled={busy}
                  value={Number.isNaN(request.fontSize) ? '' : request.fontSize} onChange={number('fontSize')} {...describe('bates-size', 'fontSize')} />
              </Field>
            </div>
            <Field id="bates-pages" label="Pages to number" error={shown('pages')} hint="Leave empty for every page, or enter pages such as 1-3, 7.">
              <input id="bates-pages" data-testid="bates-pages" className={fieldClass} value={request.pages} placeholder={`All ${pageCount} pages`} disabled={busy}
                onChange={(e) => set('pages', e.target.value)} autoComplete="off" spellCheck={false} {...describe('bates-pages', 'pages')} />
            </Field>
            <fieldset disabled={busy}>
              <legend className={labelClass}>Position</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {BATES_POSITIONS.map((position) => (
                  <label key={position} className={`flex min-h-[40px] cursor-pointer items-center justify-center rounded-lg border px-1 text-center text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                    request.position === position ? 'border-brand-500 bg-brand-500/10 text-brand-700 ring-1 ring-brand-500 dark:text-brand-200' : 'border-black/10 text-ink-700 hover:border-brand-500/40 dark:border-white/10 dark:text-zinc-200'}`}>
                    <input type="radio" name="bates-position" className="sr-only" value={position} checked={request.position === position} onChange={() => set('position', position)} data-testid={`bates-position-${position}`} />
                    {POSITION_LABELS[position]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field id="bates-color" label="Colour" error={shown('color')}>
                <div className="flex gap-2">
                  <input type="color" aria-label="Pick a colour" value={/^#[0-9a-fA-F]{6}$/.test(request.color) ? request.color : '#000000'} disabled={busy}
                    onChange={(e) => set('color', e.target.value)} className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-black/10 bg-transparent p-1 dark:border-white/10" data-testid="bates-color-picker" />
                  <input id="bates-color" data-testid="bates-color" className={fieldClass} value={request.color} maxLength={7} disabled={busy}
                    onChange={(e) => set('color', e.target.value)} autoComplete="off" spellCheck={false} {...describe('bates-color', 'color')} />
                </div>
              </Field>
              <Field id="bates-margin" label="Margin (pt)" error={shown('margin')}>
                <input id="bates-margin" data-testid="bates-margin" type="number" min={0} max={144} className={fieldClass} disabled={busy}
                  value={Number.isNaN(request.margin) ? '' : request.margin} onChange={number('margin')} {...describe('bates-margin', 'margin')} />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-700 dark:text-zinc-200">
              <input type="checkbox" checked={request.background} onChange={(e) => set('background', e.target.checked)} disabled={busy} className="h-4 w-4 rounded accent-brand-600" data-testid="bates-background" />
              White box behind the number (keeps it readable over page content)
            </label>
            <SubmitPanel
              tone="brand" icon={Hash} busy={busy} disabled={load.status !== 'ready'} onSubmit={submit}
              label="Add Bates numbers" busyLabel="Numbering…" testIdPrefix="bates"
              summary={valid && first && last ? (
                <span className="text-ink-700 dark:text-zinc-200">
                  <strong className="text-ink-900 dark:text-white">{pages.length}</strong> page{pages.length === 1 ? '' : 's'} numbered from{' '}
                  <strong className="text-ink-900 dark:text-white" data-testid="bates-first">{first}</strong> to{' '}
                  <strong className="text-ink-900 dark:text-white" data-testid="bates-last">{last}</strong>. You will get <span className="break-all">{batesFileName(file.name)}</span>.
                </span>
              ) : (
                <span className={attempted ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-zinc-400'} data-testid="bates-invalid">Fix the highlighted settings to continue.</span>
              )}
            />
          </aside>
        </div>
      )}
    </section>
  );
}
