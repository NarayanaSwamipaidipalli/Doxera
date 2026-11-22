'use client';

import React, { useState, useMemo } from 'react';

import { useReducedMotion } from 'framer-motion';
import { tools as PDF_TOOLS } from './catalog';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeading } from '@/components/ui/Card';
import { Reveal, Stagger, StaggerItem } from '@/components/ui/Motion';
import { cn } from '@/lib/cn';
import {FileText, Search, UploadCloud} from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All tools',
  basic: 'Core',
  convert: 'Convert',
  advanced: 'Advanced & OCR',
  ai: 'AI',
};

function CatalogLink({available, href, children, className}: {available:boolean;href:string;children:React.ReactNode;className:string}) {
  return available ? <a href={href} className={className}>{children}</a> : <div className={className} aria-disabled="true">{children}</div>;
}
export default function HomePage({onPick}: {onPick:(file:File)=>void}) {

  const reduce = useReducedMotion();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return PDF_TOOLS.filter((tool) => {
      const matchesSearch =
        !q || tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q);
      const matchesCategory = selectedCategory === 'all' || tool.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const categories = useMemo(
    () => [
      { id: 'all', count: PDF_TOOLS.length },
      { id: 'basic', count: PDF_TOOLS.filter((t) => t.category === 'basic').length },
      { id: 'convert', count: PDF_TOOLS.filter((t) => t.category === 'convert').length },
      { id: 'advanced', count: PDF_TOOLS.filter((t) => t.category === 'advanced').length },
      { id: 'ai', count: PDF_TOOLS.filter((t) => t.category === 'ai').length },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden pt-20 pb-24 md:pt-28 md:pb-32">
        {/* Decorative background: grid + aurora. Hidden from assistive tech. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-grid mask-fade opacity-70" />
          <div className="absolute left-1/2 top-[-18%] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-brand-500/20 blur-[130px] dark:bg-brand-500/25" />
          <div className="absolute right-[6%] top-[22%] h-[340px] w-[340px] rounded-full bg-violet-500/15 blur-[110px]" />
          <div className="absolute left-[6%] top-[38%] h-[280px] w-[280px] rounded-full bg-cyan-400/10 blur-[100px]" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">

            <Reveal delay={0.06}>
              <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight text-ink-900 dark:text-white sm:text-5xl md:text-6xl lg:text-7xl">
                Every document.
                <br />
                <span className={cn('text-gradient', !reduce && 'animate-gradient-pan')}>
                  One powerful workspace.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-ink-600 dark:text-zinc-400 md:text-lg">
                Compress, convert, sign and organize your PDFs.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">

                <Button href="#tools" variant="secondary" size="lg" className="w-full sm:w-auto">
                  Browse all tools
                </Button>
              </div>

            </Reveal>
          </div>

          <Reveal><Card glass gradientRing className="mx-auto mt-12 max-w-3xl p-1">
            <label className="relative block cursor-pointer rounded-2xl border-2 border-dashed border-brand-500/30 p-10 text-center"
              onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault(); if(e.dataTransfer.files[0]) onPick(e.dataTransfer.files[0]);}}>
              <UploadCloud className="mx-auto mb-4 h-12 w-12 text-brand-600"/>
              <span className="block text-lg font-semibold">Choose or drop a PDF to compress</span>
              <input type="file" accept=".pdf" aria-label="Choose a PDF to compress" className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={e=>{if(e.target.files?.[0]) onPick(e.target.files[0]);}}/>
            </label>
          </Card></Reveal>
        </div></section>
      {/* ================= TOOLS CATALOG ================= */}
      <section id="tools" className="scroll-mt-24 border-t border-black/5 py-20 dark:border-white/5 md:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <SectionHeading

              title={`All ${PDF_TOOLS.length} tools`}
              description="Search or filter to find the one you need."
            />
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mx-auto mt-10 max-w-xl">
              <label htmlFor="tool-search" className="sr-only">
                Search tools
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 dark:text-zinc-500"
                  aria-hidden
                />
                <input
                  id="tool-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tools…"
                  className="focus-ring h-12 w-full rounded-full border border-black/10 bg-white/70 pl-11 pr-4 text-sm text-ink-900 placeholder:text-ink-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-zinc-500"
                />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategory(c.id)}
                  aria-pressed={selectedCategory === c.id}
                  className={cn(
                    'focus-ring rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200',
                    selectedCategory === c.id
                      ? 'border-transparent bg-ink-900 text-white dark:bg-white dark:text-ink-900'
                      : 'border-black/10 text-ink-600 hover:bg-black/[0.04] dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/[0.06]',
                  )}
                >
                  {CATEGORY_LABELS[c.id]}
                  <span className="ml-1.5 opacity-60">{c.count}</span>
                </button>
              ))}
            </div>
          </Reveal>

          {filteredTools.length === 0 ? (
            <Reveal>
              <div className="mt-14 text-center">
                <p className="text-sm text-ink-500 dark:text-zinc-400">
                  No tools match “{searchQuery}”.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('all');
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </Reveal>
          ) : (
            <Stagger
              gap={0.03}
              className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {filteredTools.map((tool) => (
                <StaggerItem key={tool.slug}>
                  <CatalogLink available={tool.available}
                    href={`/tools/${tool.slug}`}
                    className="focus-ring group flex h-full items-start gap-3 rounded-xl border border-black/[0.07] bg-white/60 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-card dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:shadow-card-dark"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
                      <FileText className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-900 dark:text-white">
                        {tool.name}{!tool.available && <small className="block text-xs text-ink-500">{tool.status}</small>}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-500 dark:text-zinc-400">
                        {tool.description}
                      </span>
                    </span>
                  </CatalogLink>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </div>
      </section>

    </div>
  );
}
