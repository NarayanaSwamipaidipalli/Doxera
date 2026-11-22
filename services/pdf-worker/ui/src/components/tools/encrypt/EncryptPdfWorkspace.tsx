'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Info, Lock, Shield, ShieldCheck } from 'lucide-react';
import {
  confirmationProblem, encryptedFileName, passwordProblem, passwordStrength,
  type EncryptionMethod, type EncryptRequest,
} from '@/lib/pdf/encrypt-password';
import { PdfFileCard } from '../page-preview/PdfFileCard';
import { ModeSelector, SubmitPanel, type ModeOption } from '../page-preview/SelectionControls';
import { usePdfPreview } from '../page-preview/usePdfPreview';
import { PasswordField } from './PasswordField';

interface EncryptPdfWorkspaceProps {
  file: File;
  /** True while the upload/job is running: the form is locked and repeat submissions are ignored. */
  busy: boolean;
  /** Receives the password once; the form clears its own copy straight away. */
  onEncrypt: (request: EncryptRequest) => void;
  onRemoveFile: () => void;
}

const METHODS: ModeOption<EncryptionMethod>[] = [
  { id: 'aes-256', title: 'AES-256 (recommended)', description: 'Strongest. Opens in Adobe Acrobat 9 or later and current PDF apps.', icon: ShieldCheck },
  { id: 'aes-128', title: 'AES-128', description: 'For older readers (Acrobat 7–8). Up to 32 basic Latin characters.', icon: Shield },
];
const METHOD_NAME: Record<EncryptionMethod, string> = { 'aes-256': 'AES-256', 'aes-128': 'AES-128' };
const ALREADY_PROTECTED = 'This PDF is already password-protected. Remove its password with Unlock PDF, then encrypt it again.';
const STRENGTH_COLOURS = ['bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-500'];

export function EncryptPdfWorkspace({ file, busy, onEncrypt, onRemoveFile }: EncryptPdfWorkspaceProps) {
  const { load } = usePdfPreview(file);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [method, setMethod] = useState<EncryptionMethod>('aes-256');
  const [touched, setTouched] = useState({ password: false, confirmation: false });
  const [attempted, setAttempted] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  // A new file starts a clean form; nothing typed for the previous file is kept.
  useEffect(() => {
    setPassword('');
    setConfirmation('');
    setMethod('aes-256');
    setTouched({ password: false, confirmation: false });
    setAttempted(false);
  }, [file]);

  const ready = load.status === 'ready';
  const passwordIssue = passwordProblem(password, method);
  const confirmationIssue = confirmationProblem(password, confirmation);
  // Errors appear once a filled-in field is left, or when Encrypt is pressed; not on every keystroke.
  const showPasswordIssue = attempted || (touched.password && password !== '') ? passwordIssue : null;
  const showConfirmationIssue = attempted || (touched.confirmation && confirmation !== '') ? confirmationIssue : null;
  const strength = passwordStrength(password);
  const canSubmit = ready && !busy;

  const submit = () => {
    if (!canSubmit) return;
    if (passwordIssue || confirmationIssue) {
      setAttempted(true);
      (passwordIssue ? passwordRef : confirmationRef).current?.focus();
      return;
    }
    onEncrypt({ password, encryption: method });
    // The password is not kept in the form once handed over.
    setPassword('');
    setConfirmation('');
    setTouched({ password: false, confirmation: false });
    setAttempted(false);
  };

  const shownLoad = load.status === 'error' && load.kind === 'encrypted' ? { ...load, message: ALREADY_PROTECTED } : load;
  const outputName = encryptedFileName(file.name);

  return (
    <section aria-label="Encrypt PDF workspace" className="space-y-5" data-testid="encrypt-workspace">
      <PdfFileCard file={file} load={shownLoad} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="encrypt" />

      {ready && (
        <form
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
          noValidate
        >
          <div className="min-w-0 space-y-4 rounded-2xl border border-black/[0.07] p-4 dark:border-white/[0.07] sm:p-5">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand-600 dark:text-brand-300" aria-hidden />
              <h3 className="text-sm font-semibold text-ink-900 dark:text-white">Set a password to open the PDF</h3>
            </div>
            <PasswordField
              ref={passwordRef}
              label="Password"
              value={password}
              onChange={setPassword}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              error={showPasswordIssue}
              hint={`At least 8 characters. A few unrelated words make a strong, memorable password.`}
              disabled={busy}
              testId="encrypt-password"
            />
            <div className="-mt-1" aria-live="polite" data-testid="encrypt-strength">
              <div className="flex gap-1" aria-hidden>
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-1.5 flex-1 rounded-full ${password && strength.score >= step ? STRENGTH_COLOURS[strength.score] : 'bg-black/[0.08] dark:bg-white/[0.1]'}`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-500 dark:text-zinc-400">
                {password ? <>Strength: <span className="font-semibold text-ink-800 dark:text-zinc-100">{strength.label}</span></> : 'Strength appears as you type.'}
              </p>
            </div>
            <PasswordField
              ref={confirmationRef}
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
              onBlur={() => setTouched((t) => ({ ...t, confirmation: true }))}
              error={showConfirmationIssue}
              valid={confirmation !== '' && confirmationIssue === null}
              hint={confirmation !== '' && confirmationIssue === null ? 'Passwords match.' : 'Type the same password again.'}
              disabled={busy}
              testId="encrypt-confirm"
            />
          </div>

          <aside className="space-y-5" aria-label="Encryption options">
            <ModeSelector<EncryptionMethod> legend="Encryption strength" modes={METHODS} value={method} onChange={setMethod} disabled={busy} />
            <div className="flex gap-2.5 rounded-xl border border-black/[0.07] bg-black/[0.02] p-3.5 text-xs leading-relaxed text-ink-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-zinc-300" data-testid="encrypt-notes">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
              <ul className="space-y-1.5">
                <li>Anyone opening the PDF will need this password. Doxera doesn&apos;t keep it and can&apos;t recover it, so store it somewhere safe.</li>
                <li>Your original file isn&apos;t changed: you download an encrypted copy.</li>
                <li>Once opened with the password, the PDF can be printed and copied as usual.</li>
              </ul>
            </div>
            <SubmitPanel
              tone="brand" icon={Lock} busy={busy} disabled={!ready} onSubmit={submit}
              label="Encrypt PDF" busyLabel="Encrypting…" testIdPrefix="encrypt"
              summary={passwordIssue || confirmationIssue
                ? <span className="text-ink-500 dark:text-zinc-400">Enter and confirm a password to continue.</span>
                : <span className="text-ink-700 dark:text-zinc-200">You will get <strong className="break-all text-ink-900 dark:text-white">{outputName}</strong>, protected with {METHOD_NAME[method]}.</span>}
            />
          </aside>
        </form>
      )}
    </section>
  );
}
