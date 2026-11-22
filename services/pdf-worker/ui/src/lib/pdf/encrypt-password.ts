/**
 * Encrypt PDF: password rules for instant feedback. The API enforces the same rules
 * (apps/api/src/pdf-jobs/encrypt-parameters.ts) and the worker re-checks them; keep the three in step.
 */
export const ENCRYPTION_METHODS = ['aes-256', 'aes-128'] as const;
export type EncryptionMethod = (typeof ENCRYPTION_METHODS)[number];
export interface EncryptRequest { password: string; encryption: EncryptionMethod }

export const ENCRYPT_TOOL_IDS = ['encrypt', 'protect'] as const;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 40;
const MAX_AES256_BYTES = 127;
const MAX_AES128_CHARS = 32;

export function isEncryptTool(toolId: string): boolean {
  return (ENCRYPT_TOOL_IDS as readonly string[]).includes(toolId);
}

// Frequently used passwords of 8+ characters (lower-case). Same list as the API's.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pa$$word',
  'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'whatever', 'starwars', 'trustno1',
  'welcome1', 'welcome123', 'letmein1', 'letmein123', 'admin123', 'administrator', 'changeme', 'default1',
  'computer', 'internet', 'qwertyuiop', 'qwerty123', 'qwerty12', 'qwertyui', 'asdfghjkl', 'asdfghjk',
  'zxcvbnm1', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'q1w2e3r4', 'abc12345', 'abcd1234',
  'test1234', 'testing123', 'secret123', 'mypassword', 'monkey123', 'dragon123', 'michael1', 'jennifer',
  'charlie1', 'shadow12', 'master123', 'killer123', 'hello123', 'freedom1', 'india123', 'doxera123',
  'document', 'documents', 'confidential', 'protected', 'encrypted', 'pdfpassword', 'mypdf123',
]);
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', '0987654321'];
// Control, format (zero-width, direction marks), private-use and surrogate characters. Built at runtime
// because the project's TypeScript target (ES5) does not accept the regex literal's `u` flag.
const INVISIBLE = new RegExp('[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cs}]', 'u');
export const TOO_EASY = 'This password is too easy to guess. Choose a longer or less common one.';

function isSequence(value: string): boolean {
  const codes = Array.from(value.toLowerCase()).map((ch) => ch.codePointAt(0) ?? 0);
  const step = codes[1] - codes[0];
  return (step === 1 || step === -1) && codes.every((code, i) => i === 0 || code - codes[i - 1] === step);
}

/** Why this password can't be used, or null. */
export function passwordProblem(password: string, method: EncryptionMethod = 'aes-256'): string | null {
  if (password.trim() === '') return 'Enter a password to protect the PDF.';
  const characters = Array.from(password);
  if (characters.length < MIN_PASSWORD_LENGTH) return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (INVISIBLE.test(password)) return "Passwords can't contain control or invisible characters.";
  if (characters.length > MAX_PASSWORD_LENGTH) return `Use a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (method === 'aes-128') {
    if (!/^[\x20-\x7e]+$/.test(password)) {
      return 'AES-128 passwords can only use basic Latin letters, digits, spaces and symbols. Choose AES-256 for other characters.';
    }
    if (characters.length > MAX_AES128_CHARS) {
      return `AES-128 passwords can be at most ${MAX_AES128_CHARS} characters. Choose AES-256 for longer passwords.`;
    }
  } else if (new TextEncoder().encode(password).length > MAX_AES256_BYTES) {
    return 'This password is too long for PDF encryption. Use fewer characters.';
  }
  const lower = password.toLowerCase();
  if (new Set(characters).size === 1 || isSequence(password) || COMMON_PASSWORDS.has(lower)
    || KEYBOARD_ROWS.some((row) => row.includes(lower))) return TOO_EASY;
  return null;
}

export function confirmationProblem(password: string, confirmation: string): string | null {
  if (confirmation === '') return 'Enter the password again to confirm it.';
  return confirmation === password ? null : 'Passwords do not match.';
}

export type StrengthLabel = 'Too weak' | 'Fair' | 'Good' | 'Strong';

/** A rough guide shown while typing (length counts most); the rules above decide what is accepted. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: StrengthLabel } {
  if (passwordProblem(password) !== null) return { score: 0, label: 'Too weak' };
  const length = Array.from(password).length;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((re) => re.test(password)).length;
  const points = (length >= 12 ? 1 : 0) + (length >= 16 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  if (points >= 2) return { score: 3, label: 'Strong' };
  if (points === 1) return { score: 2, label: 'Good' };
  return { score: 1, label: 'Fair' };
}

/** "Board Minutes.pdf" -> "Board Minutes-encrypted.pdf". Never contains the password. */
export function encryptedFileName(name: string): string {
  const base = name.trim().replace(/\.pdf$/i, '') || 'document';
  return `${base}-encrypted.pdf`;
}
