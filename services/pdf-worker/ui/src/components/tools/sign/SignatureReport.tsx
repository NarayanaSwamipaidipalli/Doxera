'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { describeSignature, type SignatureSummary, type Tone } from '@/lib/pdf/sign';

const TONE: Record<Tone, { icon: typeof Info; text: string }> = {
  good: { icon: CheckCircle2, text: 'text-emerald-700 dark:text-emerald-300' },
  warn: { icon: AlertTriangle, text: 'text-amber-700 dark:text-amber-300' },
  bad: { icon: XCircle, text: 'text-rose-700 dark:text-rose-300' },
  neutral: { icon: Info, text: 'text-ink-500 dark:text-zinc-400' },
};

/** The worker's verification of the signed file: integrity, trust, revocation and time, each on its own line. */
export function SignatureReport({ summary }: { summary: SignatureSummary | null }) {
  const { headline, tone, rows } = describeSignature(summary);
  const Head = TONE[tone].icon;
  return (
    <div className="mx-auto mb-5 max-w-xl rounded-xl border border-black/[0.07] bg-[var(--elevated)] p-4 text-left dark:border-white/[0.07]" data-testid="sign-report">
      <p className={`flex items-center gap-2 text-sm font-semibold ${TONE[tone].text}`} data-testid="sign-report-headline">
        <Head className="h-4 w-4 shrink-0" aria-hidden /> {headline}
      </p>
      {rows.length > 0 && (
        <dl className="mt-3 space-y-2">
          {rows.map((row) => {
            const Icon = TONE[row.tone].icon;
            return (
              <div key={row.label} className="flex gap-2 text-xs" data-testid="sign-report-row">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE[row.tone].text}`} aria-hidden />
                <div>
                  <dt className="font-semibold text-ink-800 dark:text-zinc-100">{row.label}</dt>
                  <dd className="text-ink-600 dark:text-zinc-300">{row.value}</dd>
                </div>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
