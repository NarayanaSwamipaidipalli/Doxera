'use client';

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { chunkRanges, MAX_RANGE_GROUPS, parsePageSpec, type SpecResult } from '@/lib/pdf/page-selection';
import { inputClass, secondaryButtonClass } from './PdfFileCard';

export interface RangeGroup {
  id: number;
  text: string;
}

let nextGroupId = 1;
const newGroup = (text = ''): RangeGroup => ({ id: nextGroupId++, text });

export interface RangeGroups {
  groups: RangeGroup[];
  /** Parse result per group (null while a group is empty). */
  results: (SpecResult | null)[];
  /** Page → 1-based numbers of the groups that include it (for thumbnail badges). */
  pageGroups: Map<number, number[]>;
  texts: string[];
  update: (id: number, text: string) => void;
  remove: (id: number) => void;
  /** Adds a group, filling the first empty one when `text` is given. */
  add: (text?: string) => void;
  /** Replaces all groups with ranges of `size` pages. */
  chunk: (size: number) => boolean;
  replace: (texts: string[]) => void;
}

/** Output groups ("PDF 1: 1-5", "PDF 2: 6-10") shared by Split by ranges and Extract page groups. */
export function useRangeGroups(pageCount: number, resetKey: unknown): RangeGroups {
  const [groups, setGroups] = useState<RangeGroup[]>(() => [newGroup()]);
  useEffect(() => setGroups([newGroup()]), [resetKey]);

  const results = useMemo(() => groups.map((g) => (g.text.trim() ? parsePageSpec(g.text, pageCount) : null)), [groups, pageCount]);
  const pageGroups = useMemo(() => {
    const map = new Map<number, number[]>();
    results.forEach((result, index) => {
      for (const page of result?.pages ?? []) map.set(page, [...(map.get(page) ?? []), index + 1]);
    });
    return map;
  }, [results]);

  const update = useCallback((id: number, text: string) => setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, text } : g))), []);
  const remove = useCallback((id: number) => setGroups((gs) => (gs.length > 1 ? gs.filter((g) => g.id !== id) : [newGroup()])), []);
  const add = useCallback((text = '') => setGroups((gs) => {
    if (gs.length >= MAX_RANGE_GROUPS) return gs;
    const empty = gs.findIndex((g) => !g.text.trim());
    if (text && empty >= 0) return gs.map((g, i) => (i === empty ? { ...g, text } : g));
    return [...gs, newGroup(text)];
  }), []);
  const chunk = useCallback((size: number) => {
    if (!Number.isInteger(size) || size < 1 || pageCount < 1) return false;
    const ranges = chunkRanges(pageCount, size);
    if (ranges.length > MAX_RANGE_GROUPS) return false;
    setGroups(ranges.map((r) => newGroup(r)));
    return true;
  }, [pageCount]);

  return { groups, results, pageGroups, texts: useMemo(() => groups.map((g) => g.text), [groups]), update, remove, add, chunk, replace: (texts) => setGroups(texts.map(newGroup)) };
}

interface RangeGroupsEditorProps {
  state: RangeGroups;
  pageCount: number;
  legend: string;
  /** "PDF" → "PDF 1", "PDF 2"… */
  itemLabel: string;
  /** Label of the "N pages per group" shortcut. */
  chunkLabel?: string;
  attempted: boolean;
  disabled: boolean;
  selectedCount: number;
  /** Adds the current thumbnail selection as a new group (the caller clears the selection). */
  onUseSelection: () => void;
  onClearSelection: () => void;
}

export function RangeGroupsEditor({ state, pageCount, legend, itemLabel, chunkLabel = 'Split every N pages', attempted, disabled, selectedCount, onUseSelection, onClearSelection }: RangeGroupsEditorProps) {
  const ids = useId();
  const [bulk, setBulk] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [chunkSize, setChunkSize] = useState('5');
  const chunkNumber = Number(chunkSize);
  const chunkValid = Number.isInteger(chunkNumber) && chunkNumber >= 1 && chunkNumber <= Math.max(1, pageCount);
  const exceedsGroupLimit = chunkValid && Math.ceil(pageCount / chunkNumber) > MAX_RANGE_GROUPS;
  const full = state.groups.length >= MAX_RANGE_GROUPS;

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-1 text-sm font-semibold text-ink-900 dark:text-white">{legend}</legend>
      {itemLabel === 'PDF' && <div className="space-y-1">
        <label className="block text-xs font-semibold" htmlFor={ids + '-ranges'}>One PDF per range</label>
        <div className="flex gap-2">
          <input id={ids + '-ranges'} className={inputClass} placeholder="1-3, 4-8" value={bulk}
            onChange={e => {setBulk(e.target.value);setBulkError('');}} data-testid="split-ranges-list"/>
          <button type="button" className={secondaryButtonClass} disabled={!bulk.trim()} onClick={() => {
            const ranges = bulk.split(',').map(part => part.trim());
            const error = ranges.length > MAX_RANGE_GROUPS ? 'Too many ranges.' : ranges.map(part =>
              !part ? 'Enter a page or range between each comma.' : parsePageSpec(part, pageCount).error).find(Boolean);
            if (error) {setBulkError(error); return;}
            state.replace(ranges); setBulk(''); setBulkError('');
          }}>Use ranges</button>
        </div>
        {bulkError && <p role="alert" className="text-xs text-rose-600">{bulkError}</p>}
      </div>}
      <ol className="space-y-2.5" data-testid="range-groups">
        {state.groups.map((group, index) => {
          const result = state.results[index];
          const error = result?.error ?? (attempted && !group.text.trim() ? `Enter pages for ${itemLabel} ${index + 1}.` : null);
          return (
            <li key={group.id}>
              <div className="flex items-center gap-2">
                <label htmlFor={`${ids}-group-${group.id}`} className="w-16 shrink-0 text-xs font-semibold text-ink-600 dark:text-zinc-300">{itemLabel} {index + 1}</label>
                <input
                  id={`${ids}-group-${group.id}`}
                  value={group.text}
                  onChange={(e) => state.update(group.id, e.target.value)}
                  placeholder="e.g. 1-5"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!error}
                  aria-describedby={`${ids}-group-${group.id}-error`}
                  className={`${inputClass} min-h-[44px] ${error ? 'border-rose-500 dark:border-rose-500' : ''}`}
                  data-testid={`range-group-${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => state.remove(group.id)}
                  aria-label={`Remove ${itemLabel} ${index + 1}`}
                  className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-400 hover:bg-rose-500/10 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <p id={`${ids}-group-${group.id}-error`} className="ml-[4.5rem] mt-1 text-xs font-medium text-rose-600 dark:text-rose-400" aria-live="polite">{error ?? ''}</p>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        <button type="button" className={secondaryButtonClass} onClick={() => state.add()} disabled={full} data-testid="range-add">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add {itemLabel === 'PDF' ? 'range' : itemLabel.toLowerCase()}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onUseSelection} disabled={selectedCount === 0 || full} data-testid="range-from-selection">
          Add {selectedCount || ''} selected page{selectedCount === 1 ? '' : 's'} as {itemLabel === 'PDF' ? 'a PDF' : `an ${itemLabel.toLowerCase()}`}
        </button>
        <button type="button" className={`${secondaryButtonClass} sm:col-span-2 lg:col-span-1`} onClick={onClearSelection} disabled={selectedCount === 0} data-testid="clear-selection">
          Clear selection
        </button>
      </div>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-zinc-300">{chunkLabel}</span>
          <input
            type="number" inputMode="numeric" min={1} max={pageCount} value={chunkSize} onChange={(e) => setChunkSize(e.target.value)}
            className={`${inputClass} min-h-[44px]`} data-testid="chunk-size"
          />
        </label>
        <button type="button" className={`${secondaryButtonClass} shrink-0`} onClick={() => state.chunk(chunkNumber)} disabled={!chunkValid || exceedsGroupLimit} data-testid="chunk-apply">Apply</button>
      </div>
      {exceedsGroupLimit && <p role="alert" className="text-xs text-rose-600">Choose a larger group size (maximum {MAX_RANGE_GROUPS} output groups), or use Split every page.</p>}
    </fieldset>
  );
}
