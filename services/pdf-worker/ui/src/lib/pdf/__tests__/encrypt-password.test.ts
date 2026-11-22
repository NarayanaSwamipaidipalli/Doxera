import { describe, expect, it } from 'vitest';
import {
  confirmationProblem, encryptedFileName, isEncryptTool, passwordProblem, passwordStrength, TOO_EASY,
} from '../encrypt-password';

describe('Encrypt PDF password rules (same as the API)', () => {
  it('accepts reasonable passwords', () => {
    for (const password of ['Correct-Horse-42', 'river otter lamp 7', 'Pässwörd-日本語-42', 'x'.repeat(39) + 'Y']) {
      expect(passwordProblem(password)).toBeNull();
    }
    expect(passwordProblem('Correct-Horse-42', 'aes-128')).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(passwordProblem('')).toBe('Enter a password to protect the PDF.');
    expect(passwordProblem('    ')).toBe('Enter a password to protect the PDF.');
    expect(passwordProblem('Ab3$x9')).toBe('Use a password of at least 8 characters.');
    expect(passwordProblem('x'.repeat(40) + 'Y')).toBe('Use a password of at most 40 characters.');
    expect(passwordProblem('😀'.repeat(32))).toBe('This password is too long for PDF encryption. Use fewer characters.');
    expect(passwordProblem('good-pass​word')).toBe("Passwords can't contain control or invisible characters.");
    expect(passwordProblem('Pässwörd-2026', 'aes-128')).toMatch(/^AES-128 passwords can only use basic Latin/);
    expect(passwordProblem('a'.repeat(32) + 'B', 'aes-128')).toMatch(/at most 32 characters/);
    for (const easy of ['password', 'Password123', '12345678', 'abcdefgh', 'aaaaaaaa', 'qwertyui', 'P@ssw0rd']) {
      expect(passwordProblem(easy)).toBe(TOO_EASY);
    }
  });

  it('checks the confirmation', () => {
    expect(confirmationProblem('Correct-Horse-42', '')).toBe('Enter the password again to confirm it.');
    expect(confirmationProblem('Correct-Horse-42', 'Correct-Horse-43')).toBe('Passwords do not match.');
    expect(confirmationProblem('Correct-Horse-42', 'correct-horse-42')).toBe('Passwords do not match.');
    expect(confirmationProblem('Correct-Horse-42', 'Correct-Horse-42')).toBeNull();
  });

  it('rates strength mostly by length', () => {
    expect(passwordStrength('short').label).toBe('Too weak');
    expect(passwordStrength('password1').label).toBe('Too weak');
    expect(passwordStrength('plainletters').label).toBe('Good');
    expect(passwordStrength('mellow-otter').label).toBe('Good');
    expect(passwordStrength('Mellow-Otter-42').label).toBe('Strong');
    expect(passwordStrength('river otter lamp seven').label).toBe('Strong');
    expect(passwordStrength('Lamp-7kit').label).toBe('Good');
    expect(passwordStrength('lampkite').label).toBe('Fair');
  });

  it('names the download without the password', () => {
    expect(encryptedFileName('Board Minutes.pdf')).toBe('Board Minutes-encrypted.pdf');
    expect(encryptedFileName('report.PDF')).toBe('report-encrypted.pdf');
    expect(encryptedFileName('.pdf')).toBe('document-encrypted.pdf');
  });

  it('covers both password tools', () => {
    expect(isEncryptTool('encrypt')).toBe(true);
    expect(isEncryptTool('protect')).toBe(true);
    expect(isEncryptTool('decrypt')).toBe(false);
  });
});
