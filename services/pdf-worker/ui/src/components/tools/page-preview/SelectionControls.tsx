'use client';

import React, { useId, useState, type ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { inputClass, secondaryButtonClass } from './PdfFileCard';
import type { PageSelection } from './usePageSelection';

// ---------------------------------------------------------------- typed page field
interface PageSpecFieldProps {
  selection: PageSelection;
  pageCount: number;
  label: string;
  placeholder: string;
  help: string;
  testId: string;
  errorTestId: string;
}

export function PageSpecField({ selection, pageCount, label, placeholder, help, testId, errorTestId }: PageSpecFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={`${id}-spec`} className="mb-1.5 block text-sm font-semibold text-ink-900 dark:text-white">{label}</label>
      <input
        id={`${id}-spec`}
        data-testid={testId}
        value={selection.specText}
        onChange={(e) => selection.changeSpec(e.target.value)}
        onBlur={selection.blurSpec}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        aria-invalid={!!selection.specError}
        aria-describedby={`${id}-help ${id}-error`}
        className={`${inputClass} ${selection.specError ? 'border-rose-500 dark:border-rose-500' : ''}`}
      />
      <p id={`${id}-help`} className="mt-1.5 text-xs text-ink-500 dark:text-zinc-400">
        Pages 1–{pageCount}. {help}
      </p>
      <p id={`${id}-error`} className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400" aria-live="polite" data-testid={errorTestId}>
        {selection.specError ?? ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- start/end range picker (touch friendly)
interface RangePickerProps {
  pageCount: number;
  title: string;
  applyLabel: string;
  fromLabel: string;
  toLabel: string;
  onApply: (from: number, to: number) => void;
}

export function RangePicker({ pageCount, title, applyLabel, fromLabel, toLabel, onApply }: RangePickerProps) {
  const id = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const a = Number(from);
  const b = Number(to);
  const error = (() => {
    if (!from || !to) return null;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return 'Page numbers start at 1.';
    if (Math.max(a, b) > pageCount) return `This document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`;
    return null;
  })();
  const ready = !!from && !!to && !error;
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-ink-900 dark:text-white" id={`${id}-label`}>{title}</span>
      <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        <input
          type="number" inputMode="numeric" min={1} max={pageCount} value={from} onChange={(e) => setFrom(e.target.value)}
          aria-label={fromLabel} placeholder="From" className={`${inputClass} min-h-[44px] min-w-0`} data-testid="range-from"
        />
        <span className="text-xs text-ink-400" aria-hidden>to</span>
        <input
          type="number" inputMode="numeric" min={1} max={pageCount} value={to} onChange={(e) => setTo(e.target.value)}
          aria-label={toLabel} placeholder="To" className={`${inputClass} min-h-[44px] min-w-0`} data-testid="range-to"
        />
        <button type="button" className={`${secondaryButtonClass} shrink-0`} onClick={() => ready && onApply(a, b)} disabled={!ready} data-testid="range-apply">
          {applyLabel}
        </button>
      </div>
      {error && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- mode cards
export interface ModeOption<T extends string> {
  id: T;
  title: string;
  description: string;
  icon: LucideIcon;
}

interface ModeSelectorProps<T extends string> {
  legend: string;
  modes: ModeOption<T>[];
  value: T;
  onChange: (mode: T) => void;
  disabled: boolean;
}

export function ModeSelector<T extends string>({ legend, modes, value, onChange, disabled }: ModeSelectorProps<T>) {
  const name = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-zinc-400">{legend}</legend>
      <div className="grid gap-2">
        {modes.map(({ id, title, description, icon: Icon }) => (
          <label
            key={id}
            className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
              value === id ? 'border-brand-500 bg-brand-500/[0.08] ring-1 ring-brand-500' : 'border-black/10 hover:border-brand-500/40 dark:border-white/10'
            }`}
          >
            <input type="radio" name={`${name}-mode`} value={id} checked={value === id} onChange={() => onChange(id)} className="sr-only" data-testid={`mode-${id}`} />
            <Icon className={`h-5 w-5 shrink-0 ${value === id ? 'text-brand-600 dark:text-brand-300' : 'text-ink-400'}`} aria-hidden />
            <span>
              <span className="block text-sm font-semibold text-ink-900 dark:text-white">{title}</span>
              <span className="block text-xs text-ink-500 dark:text-zinc-400">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- primary action (panel + sticky mobile bar)
type ActionTone = 'brand' | 'rose';
const TONE: Record<ActionTone, { button: string; shadow: string }> = {
  brand: { button: 'bg-brand-600 hover:bg-brand-500', shadow: 'shadow-glow' },
  rose: { button: 'bg-rose-600 hover:bg-rose-500', shadow: 'shadow-md shadow-rose-500/20' },
};

interface ActionProps {
  tone: ActionTone;
  icon: LucideIcon;
  busy: boolean;
  disabled: boolean;
  onSubmit: () => void;
}

interface SubmitPanelProps extends ActionProps {
  label: string;
  busyLabel: string;
  /** Shown above the button: the outcome, or why the action is not available yet. */
  summary: ReactNode;
  testIdPrefix: string;
}

export function SubmitPanel({ tone, icon: Icon, busy, disabled, onSubmit, label, busyLabel, summary, testIdPrefix }: SubmitPanelProps) {
  return (
    <div className="space-y-3 border-t border-black/[0.07] pt-4 dark:border-white/[0.07]">
      <div className="text-xs" aria-live="polite" data-testid={`${testIdPrefix}-summary`}>{summary}</div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || disabled}
        aria-busy={busy}
        data-testid={`${testIdPrefix}-submit`}
        className={`focus-ring flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-ink-400 disabled:shadow-none dark:disabled:bg-ink-600 ${TONE[tone].button} ${TONE[tone].shadow}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

interface MobileActionBarProps extends ActionProps {
  text: string | null;
  label: string;
  busyLabel: string;
  optionsHref: string;
  testIdPrefix: string;
  /** Optional row shown above the action (e.g. move buttons for the current selection). */
  extra?: ReactNode;
}

/** Small screens: keeps the main action reachable while scrolling long documents. Hidden from `lg`. */
export function MobileActionBar({ tone, icon: Icon, busy, disabled, onSubmit, text, label, busyLabel, optionsHref, testIdPrefix, extra }: MobileActionBarProps) {
  return (
    <div className="sticky bottom-3 z-20 mt-4 space-y-2 rounded-2xl border border-black/10 bg-[var(--elevated)] p-2 shadow-lg dark:border-white/10 lg:hidden" data-testid={`${testIdPrefix}-mobile-bar`}>
      {extra}
      <div className="flex items-center gap-2 pl-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-700 dark:text-zinc-200" aria-hidden>{text}</span>
        <a href={optionsHref} className="focus-ring shrink-0 rounded-full px-3 py-2.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
          Options
        </a>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || disabled}
          data-testid={`${testIdPrefix}-submit-mobile`}
          className={`focus-ring flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white disabled:bg-ink-400 dark:disabled:bg-ink-600 ${TONE[tone].button}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
          {busy ? busyLabel : label}
        </button>
      </div>
    </div>
  );
}
