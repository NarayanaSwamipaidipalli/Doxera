'use client';

import React, { forwardRef, useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** When set, the field is marked invalid and this message replaces the hint. */
  error: string | null;
  hint?: ReactNode;
  /** Marks the field as correct (green border), e.g. a matching confirmation. */
  valid?: boolean;
  disabled: boolean;
  testId: string;
}

/**
 * A password input with a show/hide toggle. Colours come from the global field styles (globals.css), so it
 * follows the light and dark themes in every state, including browser autofill. The browser is asked not to
 * fill in a saved sign-in password (autocomplete="new-password").
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { label, value, onChange, onBlur, error, hint, valid, disabled, testId }, ref,
) {
  const id = useId();
  const noteId = `${id}-note`;
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-ink-700 dark:text-zinc-200">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={noteId}
          data-valid={valid && !error ? 'true' : undefined}
          data-testid={testId}
          className="focus-ring w-full rounded-xl border py-2.5 pl-3.5 pr-12 text-base transition-colors sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          disabled={disabled}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          data-testid={`${testId}-toggle`}
          className="focus-ring absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-ink-500 transition-colors hover:text-ink-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-white"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      <p
        id={noteId}
        aria-live="polite"
        data-testid={`${testId}-note`}
        className={`mt-1.5 min-h-[1.125rem] text-xs ${error
          ? 'font-medium text-rose-600 dark:text-rose-400'
          : valid ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-ink-500 dark:text-zinc-400'}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
});
