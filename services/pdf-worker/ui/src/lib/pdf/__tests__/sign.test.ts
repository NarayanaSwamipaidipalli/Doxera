import { describe, expect, it } from 'vitest';
import {
  alphaBounds, buildCertificateRequest, buildVisualRequest, bytesToBase64, certificateFileProblem, clearLightBackground,
  defaultPlacement, describeSignature, localDate, movePlacement, placementOnPage, placementToScreen, resizePlacement,
  signedFileName,
} from '../sign';

const A4 = { width: 595, height: 842 };

describe('placement', () => {
  it('starts bottom right, on the page', () => {
    const box = defaultPlacement(1, A4, 'visual');
    expect(box).toEqual({ page: 1, x: 379, y: 736, width: 180, height: 70 });
    expect(box.x + box.width).toBeLessThanOrEqual(A4.width);
  });

  it('moves in page points at any zoom and never leaves the page', () => {
    const box = { page: 1, x: 100, y: 100, width: 200, height: 60 };
    expect(movePlacement(box, 30, 15, 1.5, A4)).toMatchObject({ x: 120, y: 110 });
    expect(movePlacement(box, -5000, -5000, 1, A4)).toMatchObject({ x: 0, y: 0 });
    expect(movePlacement(box, 5000, 5000, 1, A4)).toMatchObject({ x: 395, y: 782 });
  });

  it('resizes from the corner with a minimum size and the page edge as limit', () => {
    const box = { page: 1, x: 500, y: 100, width: 60, height: 30 };
    expect(resizePlacement(box, -500, -500, 1, A4)).toMatchObject({ width: 36, height: 18 });
    expect(resizePlacement(box, 500, 20, 2, A4)).toMatchObject({ width: 95, height: 40 });
  });

  it('keeps the size when moving to a smaller page, clamped onto it', () => {
    const moved = placementOnPage({ page: 1, x: 500, y: 800, width: 200, height: 60 }, 2, { width: 300, height: 400 });
    expect(moved).toEqual({ page: 2, x: 100, y: 340, width: 200, height: 60 });
  });

  it('maps to screen pixels', () => {
    expect(placementToScreen({ page: 1, x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual({ left: 20, top: 40, width: 60, height: 80 });
  });
});

describe('signature image helpers', () => {
  it('finds the inked area and reports empty images', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    expect(alphaBounds(data, 4, 4)).toBeNull();
    data[(1 * 4 + 2) * 4 + 3] = 255;
    data[(3 * 4 + 1) * 4 + 3] = 255;
    expect(alphaBounds(data, 4, 4)).toEqual({ x: 1, y: 1, width: 2, height: 3 });
  });

  it('makes paper white transparent and keeps ink', () => {
    const data = new Uint8ClampedArray([250, 250, 250, 255, 20, 20, 60, 255, 200, 200, 200, 255]);
    clearLightBackground(data);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBeGreaterThan(0);
    expect(data[11]).toBeLessThan(255);
  });

  it('encodes bytes as base64', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 250, 255]))).toBe('AAEC+v8=');
    expect(bytesToBase64(new Uint8Array(70_000)).length).toBe(93_336);
  });
});

describe('requests', () => {
  const placement = { page: 2, x: 10, y: 20, width: 150, height: 50 };

  it('builds a visual request with only the details that are switched on and filled in', () => {
    expect(buildVisualRequest({ image: 'data:image/png;base64,AA==', placement, showName: true, signerName: '  Alex Example ', showDate: true, dateText: '', acknowledgeExistingSignatures: false }))
      .toEqual({ signMode: 'visual', signatureImage: 'data:image/png;base64,AA==', placement, showName: true, signerName: 'Alex Example', showDate: false });
  });

  it('builds a certificate request, invisible when there is no placement', () => {
    expect(buildCertificateRequest({ certificate: 'QUJD', password: 'pw', placement: null, reason: ' ', location: 'Lab', acknowledgeExistingSignatures: true }))
      .toEqual({ signMode: 'certificate', certificate: 'QUJD', certificatePassword: 'pw', location: 'Lab', acknowledgeExistingSignatures: true });
  });

  it('checks the certificate file before reading it', () => {
    expect(certificateFileProblem({ name: 'me.pfx', size: 3000 })).toBeNull();
    expect(certificateFileProblem({ name: 'me.P12', size: 3000 })).toBeNull();
    expect(certificateFileProblem({ name: 'me.pem', size: 3000 })).toContain('.pfx or .p12');
    expect(certificateFileProblem({ name: 'me.pfx', size: 0 })).toContain('empty');
    expect(certificateFileProblem({ name: 'me.pfx', size: 60_000 })).toContain('larger than 50 KB');
  });

  it('names the output and formats the default date', () => {
    expect(signedFileName('Contract v2.pdf')).toBe('Contract v2-signed.pdf');
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('verification wording', () => {
  const base = { mode: 'certificate', integrity: 'valid', cryptographicallyValid: true, coversWholeDocument: true, revocation: 'not-checked', signingTime: '2026-11-21T05:00:00+00:00', visible: true, page: 1 };

  it('never calls an untrusted signature verified', () => {
    const { headline, tone, rows } = describeSignature({ ...base, trust: 'untrusted', trustReason: 'self-signed', selfSigned: true });
    expect(headline).toBe('Digitally signed: cryptographically valid, signer not trusted');
    expect(headline.toLowerCase()).not.toContain('verified');
    expect(tone).toBe('warn');
    expect(rows.find((r) => r.label === 'Signature integrity')?.tone).toBe('good');
    expect(rows.find((r) => r.label === 'Signer certificate')?.value).toContain('self-signed');
    expect(rows.find((r) => r.label === 'Revocation')?.value).toContain('not checked');
    expect(rows.find((r) => r.label === 'Signing time')?.value).toContain('not a trusted timestamp');
  });

  it('reports trust only when the chain is trusted, and failures as failures', () => {
    expect(describeSignature({ ...base, trust: 'trusted' }).headline).toContain('trusted certificate');
    expect(describeSignature({ ...base, trust: 'untrusted', trustReason: 'no-trust-list' }).rows[1].value).toContain('Not checked against a trust list');
    expect(describeSignature({ ...base, integrity: 'invalid', trust: 'trusted' }).tone).toBe('bad');
    expect(describeSignature({ ...base, trust: 'untrusted', timestamp: { status: 'valid', trusted: false, time: 't' } }).rows.find((r) => r.label === 'Signing time')?.value)
      .toContain('authority not in a trust list');
  });

  it('labels a visual signature as an appearance, not a digital signature', () => {
    const { headline, rows } = describeSignature({ mode: 'visual', page: 3 });
    expect(headline).toBe('Visual signature added');
    expect(rows[0].value).toContain('Not a certificate-based digital signature');
  });

  it('copes with a missing report', () => {
    expect(describeSignature(null).rows).toEqual([]);
  });
});
