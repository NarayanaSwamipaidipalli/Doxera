/**
 * Sign PDF: request building, placement geometry and honest wording for the two signing modes.
 *
 * - Visual signature: an image of a signature placed on a page. It does not identify the signer or detect changes.
 * - Certificate signature: a PDF digital signature made with the user's PKCS#12 certificate.
 *
 * Placement is on the page as displayed (rotation applied), in PDF points, top-left origin, the same space
 * pdf.js uses at scale 1. The worker converts it to PDF coordinates.
 */

export type SignMode = 'visual' | 'certificate';

export interface Placement {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageSize {
  width: number;
  height: number;
}

export const MIN_BOX = { width: 36, height: 18 };
export const MAX_CERTIFICATE_BYTES = 50_000;
export const MAX_SIGNATURE_IMAGE_CHARS = 80_000;
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface VisualSignRequest {
  signMode: 'visual';
  signatureImage: string;
  placement: Placement;
  showName: boolean;
  signerName?: string;
  showDate: boolean;
  dateText?: string;
  acknowledgeExistingSignatures?: boolean;
}

export interface CertificateSignRequest {
  signMode: 'certificate';
  certificate: string;
  certificatePassword: string;
  placement?: Placement;
  reason?: string;
  location?: string;
  acknowledgeExistingSignatures?: boolean;
}

export type SignRequest = VisualSignRequest | CertificateSignRequest;

const round = (value: number) => Math.round(value * 100) / 100;

function clampBox(box: Placement, page: PageSize): Placement {
  const width = Math.min(Math.max(box.width, MIN_BOX.width), page.width);
  const height = Math.min(Math.max(box.height, MIN_BOX.height), page.height);
  const x = Math.min(Math.max(box.x, 0), page.width - width);
  const y = Math.min(Math.max(box.y, 0), page.height - height);
  return { page: box.page, x: round(x), y: round(y), width: round(width), height: round(height) };
}

/** A sensible first position: bottom right, 36 pt from the edges, sized for the mode. */
export function defaultPlacement(pageNumber: number, page: PageSize, mode: SignMode): Placement {
  const width = Math.min(mode === 'visual' ? 180 : 220, page.width - 72);
  const height = mode === 'visual' ? 70 : 64;
  return clampBox({ page: pageNumber, x: page.width - width - 36, y: page.height - height - 36, width, height }, page);
}

/** Moves the box by a screen delta at the given zoom, keeping it fully on the page. */
export function movePlacement(box: Placement, dx: number, dy: number, zoom: number, page: PageSize): Placement {
  return clampBox({ ...box, x: box.x + dx / zoom, y: box.y + dy / zoom }, page);
}

/** Resizes from the bottom-right corner by a screen delta, keeping the minimum size and the page bounds. */
export function resizePlacement(box: Placement, dx: number, dy: number, zoom: number, page: PageSize): Placement {
  const width = Math.min(Math.max(box.width + dx / zoom, MIN_BOX.width), page.width - box.x);
  const height = Math.min(Math.max(box.height + dy / zoom, MIN_BOX.height), page.height - box.y);
  return { ...box, width: round(width), height: round(height) };
}

/** Moves the box to another page, keeping its size and clamping it onto that page. */
export function placementOnPage(box: Placement, pageNumber: number, page: PageSize): Placement {
  return clampBox({ ...box, page: pageNumber }, page);
}

export function placementToScreen(box: Placement, zoom: number) {
  return { left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom };
}

/** Bounding box of pixels with alpha above the threshold (RGBA data), or null when the image is empty. */
export function alphaBounds(data: ArrayLike<number>, width: number, height: number, threshold = 8) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Makes a light background transparent in place (RGBA data): pixels close to white become clear, so a photo or
 * scan of a signature on paper sits on the page without a white box.
 */
export function clearLightBackground(data: Uint8ClampedArray, threshold = 225): void {
  for (let i = 0; i < data.length; i += 4) {
    const lightness = Math.min(data[i], data[i + 1], data[i + 2]);
    if (lightness >= threshold) data[i + 3] = 0;
    else if (lightness > threshold - 40) data[i + 3] = Math.round(data[i + 3] * (threshold - lightness) / 40);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

/** Problems with a chosen certificate file, checked before it is read. */
export function certificateFileProblem(file: { name: string; size: number }): string | null {
  if (!/\.(pfx|p12)$/i.test(file.name)) return 'Choose a PKCS#12 certificate file (.pfx or .p12).';
  if (file.size === 0) return 'This certificate file is empty.';
  if (file.size > MAX_CERTIFICATE_BYTES) return 'This certificate file is larger than 50 KB. Export only the signing certificate, its private key and chain.';
  return null;
}

const clean = (value: string, limit: number) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);

export function buildVisualRequest(options: {
  image: string; placement: Placement; showName: boolean; signerName: string; showDate: boolean; dateText: string;
  acknowledgeExistingSignatures: boolean;
}): VisualSignRequest {
  const request: VisualSignRequest = {
    signMode: 'visual',
    signatureImage: options.image,
    placement: options.placement,
    showName: options.showName && clean(options.signerName, 80) !== '',
    showDate: options.showDate && clean(options.dateText, 40) !== '',
  };
  if (request.showName) request.signerName = clean(options.signerName, 80);
  if (request.showDate) request.dateText = clean(options.dateText, 40);
  if (options.acknowledgeExistingSignatures) request.acknowledgeExistingSignatures = true;
  return request;
}

export function buildCertificateRequest(options: {
  certificate: string; password: string; placement: Placement | null; reason: string; location: string;
  acknowledgeExistingSignatures: boolean;
}): CertificateSignRequest {
  const request: CertificateSignRequest = {
    signMode: 'certificate',
    certificate: options.certificate,
    certificatePassword: options.password,
  };
  if (options.placement) request.placement = options.placement;
  if (clean(options.reason, 120)) request.reason = clean(options.reason, 120);
  if (clean(options.location, 80)) request.location = clean(options.location, 80);
  if (options.acknowledgeExistingSignatures) request.acknowledgeExistingSignatures = true;
  return request;
}

export function signedFileName(name: string): string {
  const base = name.replace(/\.[^/.]+$/, '').trim() || 'document';
  return `${base}-signed.pdf`;
}

/** Today's date as YYYY-MM-DD in the viewer's time zone (the default for the visual date line). */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ------------------------------------------------------------------------------------------- result report

export interface SignatureSummary {
  mode?: string;
  integrity?: string;
  cryptographicallyValid?: boolean;
  coversWholeDocument?: boolean;
  trust?: string;
  trustReason?: string | null;
  selfSigned?: boolean;
  certificate?: { subject?: string; issuer?: string; notBefore?: string; notAfter?: string; fingerprintSha256?: string };
  revocation?: string;
  timestamp?: { status?: string; trusted?: boolean; time?: string };
  signingTime?: string | null;
  signingTimeSource?: string;
  existingSignatures?: number;
  originalPreserved?: boolean;
  page?: number | null;
  visible?: boolean;
  signatureFormat?: string;
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';
export interface ReportRow { label: string; value: string; tone: Tone }

const day = (iso?: string) => (iso ? iso.slice(0, 10) : 'unknown');

/**
 * Rows for the result panel. Integrity, trust, revocation and time are separate lines; nothing here says
 * "verified" unless the signer's certificate is actually trusted.
 */
export function describeSignature(summary: SignatureSummary | null | undefined): { headline: string; tone: Tone; rows: ReportRow[] } {
  if (!summary || !summary.mode) return { headline: 'Signed. No verification report is available for this job.', tone: 'neutral', rows: [] };
  if (summary.mode === 'visual') {
    return {
      headline: 'Visual signature added',
      tone: 'neutral',
      rows: [
        { label: 'Type', value: 'Visual signature appearance (an image on the page). Not a certificate-based digital signature: it does not prove who signed and does not detect later changes.', tone: 'neutral' },
        ...(summary.page ? [{ label: 'Placed on', value: `Page ${summary.page}`, tone: 'neutral' as Tone }] : []),
        ...(summary.existingSignatures ? [{ label: 'Earlier signatures', value: `${summary.existingSignatures} kept unchanged; readers will show the document changed after they were made.`, tone: 'warn' as Tone }] : []),
      ],
    };
  }

  const intact = summary.integrity === 'valid' && summary.cryptographicallyValid === true && summary.coversWholeDocument === true;
  const trusted = summary.trust === 'trusted';
  const rows: ReportRow[] = [
    {
      label: 'Signature integrity',
      value: intact ? 'Valid: the signature matches the document and covers all of it (checked after signing).' : 'Not valid.',
      tone: intact ? 'good' : 'bad',
    },
    {
      label: 'Signer certificate',
      value: trusted
        ? 'Trusted: it chains to a root certificate in Doxera\'s trust list.'
        : summary.trustReason === 'self-signed'
          ? 'Untrusted: self-signed. Readers such as Adobe Acrobat will show the signer\'s identity as unknown unless the recipient trusts this certificate.'
          : summary.trustReason === 'not-in-trust-list'
            ? 'Untrusted: it does not chain to a root in Doxera\'s trust list. Readers decide trust with their own lists.'
            : 'Not checked against a trust list. Readers such as Adobe Acrobat decide trust with their own lists.',
      tone: trusted ? 'good' : 'warn',
    },
  ];
  if (summary.certificate) {
    const c = summary.certificate;
    rows.push({ label: 'Signed as', value: `${c.subject || 'Unknown'} (issued by ${c.issuer || 'unknown'}; valid ${day(c.notBefore)} to ${day(c.notAfter)})`, tone: 'neutral' });
  }
  rows.push({
    label: 'Revocation',
    value: summary.revocation === 'good' ? 'Checked: not revoked.' : 'Unknown: revocation status was not checked.',
    tone: summary.revocation === 'good' ? 'good' : 'neutral',
  });
  rows.push(summary.timestamp?.status === 'valid'
    ? {
      label: 'Signing time',
      value: `${summary.timestamp.time || ''} from a timestamp authority${summary.timestamp.trusted ? ' (trusted)' : ' (authority not in a trust list)'}.`,
      tone: summary.timestamp.trusted ? 'good' : 'warn',
    }
    : {
      label: 'Signing time',
      value: `${summary.signingTime ? summary.signingTime.replace('T', ' ').slice(0, 19) + ' UTC' : 'Unknown'}, from Doxera's server clock. This is not a trusted timestamp.`,
      tone: 'neutral',
    });
  if (summary.existingSignatures) {
    rows.push({ label: 'Earlier signatures', value: `${summary.existingSignatures} kept unchanged (added as an incremental update).`, tone: 'neutral' });
  }
  rows.push({ label: 'Format', value: `${summary.signatureFormat || 'PDF signature'}; ${summary.visible ? `visible on page ${summary.page}` : 'invisible (no mark on the page)'}.`, tone: 'neutral' });

  const headline = !intact
    ? 'Signature could not be confirmed'
    : trusted
      ? 'Digitally signed: valid signature from a trusted certificate'
      : 'Digitally signed: cryptographically valid, signer not trusted';
  return { headline, tone: !intact ? 'bad' : trusted ? 'good' : 'warn', rows };
}
