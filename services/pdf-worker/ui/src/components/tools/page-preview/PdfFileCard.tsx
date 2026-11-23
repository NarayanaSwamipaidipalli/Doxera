'use client';

import React from 'react';
import { AlertCircle, FileText, Loader2, RefreshCw } from 'lucide-react';
import type { PdfLoadState } from './usePdfPreview';

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

export const secondaryButtonClass =
  'focus-ring inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3.5 text-xs font-semibold text-ink-700 transition-colors hover:border-brand-500/50 hover:bg-brand-500/[0.06] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-zinc-200';

export const inputClass =
  'focus-ring w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 dark:border-white/10 dark:bg-ink-900 dark:text-white';

interface PdfFileCardProps {
  file: File;
  load: PdfLoadState;
  busy: boolean;
  onRemoveFile: () => void;
  /** Prefix for test ids, e.g. "split" → split-file-name, split-file-meta, split-load-error. */
  testIdPrefix: string;
}

/** File name/size/page count, plus the loading progress and unreadable-file states. */
export function PdfFileCard({ file, load, busy, onRemoveFile, testIdPrefix }: PdfFileCardProps) {
  const pageCount = load.status === 'ready' ? load.pageCount : 0;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.07] bg-black/[0.03] p-4 dark:border-white/[0.07] dark:bg-white/[0.04]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <FileText className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink-900 dark:text-white" data-testid={`${testIdPrefix}-file-name`}>{file.name}</div>
            <div className="text-xs text-ink-500 dark:text-zinc-400" data-testid={`${testIdPrefix}-file-meta`}>
              {formatBytes(file.size)}
              {' · '}
              {load.status === 'ready' ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : load.status === 'loading' ? 'Reading pages…' : 'Unreadable'}
            </div>
          </div>
        </div>
        <button type="button" onClick={onRemoveFile} disabled={busy} className={secondaryButtonClass}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Choose another file
        </button>
      </div>

      {load.status === 'loading' && (
        <div className="rounded-2xl border border-black/[0.07] p-6 text-center dark:border-white/[0.07]" role="status" aria-live="polite">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-brand-500" aria-hidden />
          <div className="mb-3 text-sm font-medium text-ink-800 dark:text-zinc-100">Reading your PDF…</div>
          <div className="mx-auto h-1.5 max-w-xs overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]">
            <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.round(load.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {load.status === 'error' && (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[0.08] p-4 text-sm text-rose-800 dark:text-rose-300 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid={`${testIdPrefix}-load-error`}>
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{load.message}</span>
          </div>
          <button type="button" onClick={onRemoveFile} className="focus-ring min-h-[44px] shrink-0 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-500">
            Choose another file
          </button>
        </div>
      )}
    </>
  );
}
