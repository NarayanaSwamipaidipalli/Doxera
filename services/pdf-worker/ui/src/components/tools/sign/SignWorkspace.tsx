'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import {
  AlertTriangle, BadgeCheck, Eraser, FileKey2, Info, Loader2, Minus, PenLine, Plus, Type, Upload, X,
} from 'lucide-react';
import { isRenderCancelled, releaseCanvas, renderPage } from '@/lib/pdf/pdf-document';
import {
  alphaBounds, buildCertificateRequest, buildVisualRequest, bytesToBase64, certificateFileProblem, clearLightBackground,
  defaultPlacement, localDate, MAX_SIGNATURE_IMAGE_CHARS, movePlacement, placementOnPage, placementToScreen,
  resizePlacement, signedFileName, ZOOM_LEVELS, type PageSize, type Placement, type SignMode, type SignRequest,
} from '@/lib/pdf/sign';
import { PasswordField } from '../encrypt/PasswordField';
import { PdfFileCard } from '../page-preview/PdfFileCard';
import { ThumbnailImage } from '../page-preview/PageThumbnail';
import { ModeSelector, SubmitPanel, type ModeOption } from '../page-preview/SelectionControls';
import { usePdfPreview, type PdfPreview } from '../page-preview/usePdfPreview';

interface SignWorkspaceProps {
  file: File;
  busy: boolean;
  /** Receives the request once; the certificate password and file contents are not kept in this form afterwards. */
  onSign: (request: SignRequest) => void;
  onRemoveFile: () => void;
}

type Source = 'draw' | 'type' | 'upload';

const MODES: ModeOption<SignMode>[] = [
  { id: 'visual', title: 'Visual signature', description: 'Draw, type or upload your signature and place it on the page.', icon: PenLine },
  { id: 'certificate', title: 'Certificate digital signature', description: 'A cryptographic PDF signature made with your .pfx/.p12 certificate.', icon: FileKey2 },
];

const INKS = [
  { color: '#0f172a', label: 'Black ink' },
  { color: '#1d4ed8', label: 'Blue ink' },
];
const TYPE_FONTS = [
  { id: 'script', label: 'Script', css: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive' },
  { id: 'italic', label: 'Italic', css: 'Georgia, "Times New Roman", serif' },
];

/** Trims transparent margins and returns a PNG data URL small enough for the request (downscaling if needed). */
function canvasToSignature(source: HTMLCanvasElement): string | null {
  const context = source.getContext('2d');
  if (!context) return null;
  const pixels = context.getImageData(0, 0, source.width, source.height);
  const bounds = alphaBounds(pixels.data, source.width, source.height);
  if (!bounds) return null;
  let scale = Math.min(1, 900 / bounds.width, 300 / bounds.height);
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(bounds.width * scale));
    out.height = Math.max(1, Math.round(bounds.height * scale));
    const target = out.getContext('2d');
    if (!target) return null;
    target.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/png');
    if (url.length <= MAX_SIGNATURE_IMAGE_CHARS) return url;
    scale *= 0.75;
  }
  return null;
}

function Thumb({ page, preview, active, marked, aspect, onSelect }: { page: number; preview: PdfPreview; active: boolean; marked: boolean; aspect: number; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { observe, thumbnails } = preview;
  useEffect(() => (ref.current ? observe(ref.current, page) : undefined), [observe, page]);
  return (
    <button ref={ref} type="button" onClick={onSelect} aria-current={active ? 'page' : undefined} data-testid={`sign-page-${page}`}
      className={`focus-ring relative w-full rounded-lg border p-1 text-left transition-colors ${active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-black/10 hover:border-brand-500/40 dark:border-white/10'}`}>
      <span className="block overflow-hidden rounded bg-white"><ThumbnailImage url={thumbnails.urls[page]} failed={Boolean(thumbnails.failed[page])} aspectRatio={aspect} /></span>
      <span className="mt-1 flex items-center justify-between text-[11px] text-ink-600 dark:text-zinc-300">
        Page {page}
        {marked && <PenLine className="h-3 w-3 text-brand-600 dark:text-brand-300" aria-label="Signature on this page" />}
      </span>
    </button>
  );
}

export function SignWorkspace({ file, busy, onSign, onRemoveFile }: SignWorkspaceProps) {
  const preview = usePdfPreview(file);
  const { load, doc, pageCount } = preview;
  const [mode, setMode] = useState<SignMode>('visual');
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sizes, setSizes] = useState<Record<number, PageSize>>({});
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [existingFields, setExistingFields] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ kind: 'move' | 'resize'; x: number; y: number; start: Placement } | null>(null);

  // Visual signature
  const [source, setSource] = useState<Source>('draw');
  const [ink, setInk] = useState(INKS[0].color);
  const [image, setImage] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [typedFont, setTypedFont] = useState(TYPE_FONTS[0].id);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showName, setShowName] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [showDate, setShowDate] = useState(true);
  const [dateText, setDateText] = useState(localDate());
  const padRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // Certificate signature
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certError, setCertError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [visibleStamp, setVisibleStamp] = useState(true);
  const certInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrent(1); setPlacement(null); setSizes({}); setExistingFields(0); setAcknowledged(false);
  }, [file]);

  // Page sizes as displayed (pdf.js scale 1), and signature fields already in the document.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      for (let n = 1; n <= pageCount && !cancelled; n++) {
        const page: PDFPageProxy = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        if (!cancelled) setSizes((all) => ({ ...all, [n]: { width: viewport.width, height: viewport.height } }));
      }
      const fields = await doc.getFieldObjects().catch(() => null);
      if (!cancelled && fields) {
        setExistingFields(Object.values(fields).flat().filter((field) => (field as { type?: string }).type === 'signature').length);
      }
    })().catch(() => { /* preview only */ });
    return () => { cancelled = true; };
  }, [doc, pageCount]);

  // First placement once the first page size is known; later page switches keep the size and clamp it.
  useEffect(() => {
    const size = sizes[current];
    if (!size) return;
    setPlacement((box) => (box ? (box.page === current ? box : placementOnPage(box, current, size)) : defaultPlacement(current, size, mode)));
  }, [sizes, current, mode]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const canvas = canvasRef.current;
    setRendering(true);
    void (async () => {
      const page = await doc.getPage(current);
      if (cancelled) return;
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const context = canvas.getContext('2d');
      if (!context) return;
      const render = renderPage(page, canvas, context, zoom * ratio);
      task = render;
      const viewport = page.getViewport({ scale: zoom });
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await render.promise;
      if (!cancelled) setRendering(false);
    })().catch((error) => { if (!isRenderCancelled(error) && !cancelled) setRendering(false); });
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, current, zoom]);
  useEffect(() => () => releaseCanvas(canvasRef.current), []);

  // ------------------------------------------------------------------ signature sources
  const padPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) * (canvas.width / box.width), y: (event.clientY - box.top) * (canvas.height / box.height) };
  };
  const padDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = padPoint(event);
    context.strokeStyle = ink;
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(p.x, p.y);
    context.lineTo(p.x + 0.1, p.y + 0.1);
    context.stroke();
    drawing.current = true;
  };
  const padMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const p = padPoint(event);
    context.lineTo(p.x, p.y);
    context.stroke();
  };
  const padUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (padRef.current) setImage(canvasToSignature(padRef.current));
  };
  const clearPad = () => {
    const canvas = padRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setImage(null);
  };

  // Typed signatures are rendered to an image here, so the PDF shows exactly what the preview shows.
  useEffect(() => {
    if (source !== 'type') return;
    const text = typed.trim();
    if (!text) { setImage(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) return;
    const font = TYPE_FONTS.find((f) => f.id === typedFont) ?? TYPE_FONTS[0];
    context.font = `${typedFont === 'italic' ? 'italic ' : ''}96px ${font.css}`;
    context.fillStyle = ink;
    context.textBaseline = 'middle';
    context.fillText(text.slice(0, 60), 20, 120, 1160);
    setImage(canvasToSignature(canvas));
  }, [source, typed, typedFont, ink]);

  const onUpload = async (chosen: File | undefined) => {
    setUploadError(null);
    setImage(null);
    if (!chosen) return;
    if (!/^image\/(png|jpeg)$/.test(chosen.type)) { setUploadError('Choose a PNG or JPEG image of your signature.'); return; }
    if (chosen.size > 2 * 1024 * 1024) { setUploadError('Choose an image under 2 MB.'); return; }
    try {
      const bitmap = await createImageBitmap(chosen);
      const scale = Math.min(1, 1200 / bitmap.width, 400 / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      clearLightBackground(pixels.data);
      context.putImageData(pixels, 0, 0);
      const url = canvasToSignature(canvas);
      if (!url) setUploadError('No signature was found in this image. Use dark ink on a light background.');
      setImage(url);
    } catch {
      setUploadError('This image could not be read.');
    }
  };

  const chooseSource = (next: Source) => {
    setSource(next);
    setImage(null);
    setUploadError(null);
    if (next === 'draw') requestAnimationFrame(clearPad);
  };

  const onCertificate = (chosen: File | undefined) => {
    setCertError(null);
    setCertFile(null);
    if (!chosen) return;
    const problem = certificateFileProblem(chosen);
    if (problem) { setCertError(problem); return; }
    setCertFile(chosen);
  };

  // ------------------------------------------------------------------ placement gestures
  const size = sizes[current];
  const startGesture = (kind: 'move' | 'resize') => (event: React.PointerEvent<HTMLElement>) => {
    if (busy || !placement || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, start: placement };
  };
  const moveGesture = (event: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || !size) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    setPlacement(g.kind === 'move' ? movePlacement(g.start, dx, dy, zoom, size) : resizePlacement(g.start, dx, dy, zoom, size));
  };
  const endGesture = () => { gesture.current = null; };
  const placeAt = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy || !placement || !size || event.button !== 0 || event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / zoom - placement.width / 2;
    const y = (event.clientY - box.top) / zoom - placement.height / 2;
    setPlacement(movePlacement({ ...placement, x, y }, 0, 0, 1, size));
  };
  const onBoxKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!placement || !size) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    setPlacement(event.altKey ? resizePlacement(placement, d[0], d[1], 1, size) : movePlacement(placement, d[0], d[1], 1, size));
  };

  // ------------------------------------------------------------------ submit
  const showsBox = mode === 'visual' || visibleStamp;
  const ackNeeded = existingFields > 0 && !acknowledged;
  const visualReady = Boolean(image && placement);
  const certReady = Boolean(certFile && (!visibleStamp || placement));
  const ready = load.status === 'ready' && !ackNeeded && (mode === 'visual' ? visualReady : certReady);

  const submit = async () => {
    if (!ready || busy) return;
    if (mode === 'visual' && image && placement) {
      onSign(buildVisualRequest({ image, placement, showName, signerName, showDate, dateText, acknowledgeExistingSignatures: acknowledged }));
      return;
    }
    if (mode === 'certificate' && certFile) {
      let encoded: string;
      try {
        encoded = bytesToBase64(new Uint8Array(await certFile.arrayBuffer()));
      } catch {
        setCertError('The certificate file could not be read. Choose it again.');
        return;
      }
      const typedPassword = password;
      setPassword(''); // the request is the only copy from here on
      onSign(buildCertificateRequest({
        certificate: encoded, password: typedPassword, placement: visibleStamp ? placement : null, reason, location,
        acknowledgeExistingSignatures: acknowledged,
      }));
    }
  };

  const screen = placement && placement.page === current ? placementToScreen(placement, zoom) : null;
  const lines = mode === 'visual' ? [showName ? signerName.trim() : '', showDate ? dateText.trim() : ''].filter(Boolean) : [];
  const fontPx = placement ? Math.max(6, Math.min(10, placement.height * 0.13)) * zoom : 10;
  const loaded = load.status === 'ready';
  const fieldClass = 'focus-ring w-full rounded-xl border px-3 py-2 text-base sm:text-sm';

  return (
    <section aria-label="Sign PDF workspace" className="space-y-5" data-testid="sign-workspace">
      <PdfFileCard file={file} load={load} busy={busy} onRemoveFile={onRemoveFile} testIdPrefix="sign" />
      {loaded && (
        <div className="grid gap-5 lg:grid-cols-[120px_minmax(0,1fr)_340px]">
          <nav aria-label="Pages" className="flex gap-2 overflow-x-auto lg:max-h-[75vh] lg:flex-col lg:overflow-y-auto">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <div key={n} className="w-24 shrink-0 lg:w-full">
                <Thumb page={n} preview={preview} active={n === current} marked={showsBox && placement?.page === n}
                  aspect={sizes[n] ? sizes[n].width / sizes[n].height : load.aspectRatio} onSelect={() => setCurrent(n)} />
              </div>
            ))}
          </nav>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-600 dark:text-zinc-300" data-testid="sign-page-label">
                {showsBox
                  ? <>Page {current} of {pageCount}. Drag the box to move it, drag its corner to resize, or click the page to place it there.</>
                  : <>Page {current} of {pageCount}. The signature will be invisible (no mark on any page).</>}
              </p>
              <div className="flex items-center gap-1" role="group" aria-label="Zoom">
                <button type="button" className="focus-ring rounded-lg border border-black/10 p-1.5 disabled:opacity-40 dark:border-white/10" aria-label="Zoom out"
                  disabled={zoom <= ZOOM_LEVELS[0]} onClick={() => setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]) - 1)])}><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-12 text-center text-xs font-semibold text-ink-800 dark:text-zinc-100" data-testid="sign-zoom">{Math.round(zoom * 100)}%</span>
                <button type="button" className="focus-ring rounded-lg border border-black/10 p-1.5 disabled:opacity-40 dark:border-white/10" aria-label="Zoom in"
                  disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} onClick={() => setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]) + 1)])}><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="overflow-auto rounded-xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]" style={{ maxHeight: '75vh' }} data-testid="sign-viewer">
              <div className="relative mx-auto w-max select-none shadow-md">
                <canvas ref={canvasRef} className="block bg-white" data-testid="sign-canvas" />
                <div className="absolute inset-0" style={{ touchAction: 'none' }} data-testid="sign-surface" onPointerDown={showsBox ? placeAt : undefined}>
                  {showsBox && screen && (
                    <div
                      role="group"
                      tabIndex={0}
                      aria-label={`Signature position on page ${current}. Arrow keys move it; Alt plus arrow keys resize it.`}
                      onKeyDown={onBoxKey}
                      onPointerDown={startGesture('move')}
                      onPointerMove={moveGesture}
                      onPointerUp={endGesture}
                      onPointerCancel={endGesture}
                      className={`focus-ring absolute flex flex-col overflow-hidden border-2 border-dashed ${busy ? 'cursor-not-allowed' : 'cursor-move'} ${mode === 'visual' ? 'border-brand-500 bg-brand-500/[0.06]' : 'border-blue-700 bg-[#f5f7ff]/90'}`}
                      style={screen}
                      data-testid="sign-box"
                    >
                      {mode === 'visual' ? (
                        <>
                          <div className="flex min-h-0 flex-1 items-center justify-center">
                            {image
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={image} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                              : <span className="px-1 text-center text-[11px] text-brand-700 dark:text-brand-300">Your signature</span>}
                          </div>
                          {lines.map((line) => (
                            <span key={line} className="block truncate px-0.5 leading-tight text-slate-700" style={{ fontSize: fontPx, fontFamily: 'DejaVu Sans, Verdana, sans-serif' }}>{line}</span>
                          ))}
                        </>
                      ) : (
                        <div className="flex h-full flex-col justify-center px-1 leading-tight text-slate-900" style={{ fontSize: Math.max(6, Math.min(9 * zoom, (screen.height - 8) / 5)), fontFamily: 'Helvetica, Arial, sans-serif' }}>
                          <span className="truncate">Digitally signed by (name from certificate)</span>
                          <span className="truncate">Date: (time of signing, UTC)</span>
                          {reason.trim() && <span className="truncate">Reason: {reason.trim()}</span>}
                          {location.trim() && <span className="truncate">Location: {location.trim()}</span>}
                        </div>
                      )}
                      <span
                        onPointerDown={startGesture('resize')}
                        onPointerMove={moveGesture}
                        onPointerUp={endGesture}
                        onPointerCancel={endGesture}
                        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize rounded-tl bg-brand-600"
                        aria-hidden
                        data-testid="sign-resize"
                      />
                    </div>
                  )}
                </div>
                {rendering && <div className="absolute inset-0 flex items-center justify-center bg-white/40"><Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden /></div>}
              </div>
            </div>
          </div>

          <aside className="space-y-4" aria-label="Signature options">
            <ModeSelector<SignMode> legend="Signing mode" modes={MODES} value={mode} onChange={setMode} disabled={busy} />

            {mode === 'visual' ? (
              <div className="space-y-4" data-testid="sign-visual-options">
                <div className="flex gap-2.5 rounded-xl border border-black/[0.07] bg-black/[0.02] p-3 text-xs leading-relaxed text-ink-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-zinc-300" data-testid="sign-visual-note">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
                  <span>A visual signature is an image of your signature on the page. It does not prove who signed and does not detect later changes. Use a certificate digital signature when that matters.</span>
                </div>
                <div role="tablist" aria-label="Signature source" className="grid grid-cols-3 gap-1 rounded-xl border border-black/10 p-1 dark:border-white/10">
                  {([['draw', 'Draw', PenLine], ['type', 'Type', Type], ['upload', 'Upload', Upload]] as const).map(([id, label, Icon]) => (
                    <button key={id} type="button" role="tab" aria-selected={source === id} disabled={busy} onClick={() => chooseSource(id)} data-testid={`sign-source-${id}`}
                      className={`focus-ring flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${source === id ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-black/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.06]'}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                    </button>
                  ))}
                </div>
                {source !== 'upload' && (
                  <div className="flex items-center gap-2 text-xs text-ink-600 dark:text-zinc-300">
                    <span>Ink</span>
                    {INKS.map((option) => (
                      <button key={option.color} type="button" onClick={() => setInk(option.color)} aria-label={option.label} aria-pressed={ink === option.color}
                        className={`focus-ring h-5 w-5 rounded-full border border-black/20 ${ink === option.color ? 'ring-2 ring-brand-500 ring-offset-1' : ''}`} style={{ backgroundColor: option.color }} />
                    ))}
                  </div>
                )}
                {source === 'draw' && (
                  <div className="relative">
                    <canvas ref={padRef} width={900} height={300} onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerCancel={padUp}
                      className="h-32 w-full cursor-crosshair rounded-xl border border-black/15 bg-white dark:border-white/15" style={{ touchAction: 'none' }}
                      aria-label="Signature drawing area: draw with a mouse, pen or finger" data-testid="sign-pad" />
                    <button type="button" onClick={clearPad} disabled={busy} className="focus-ring absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/[0.06] px-2 py-1 text-[11px] font-medium text-ink-800" data-testid="sign-pad-clear">
                      <Eraser className="h-3 w-3" aria-hidden /> Clear
                    </button>
                  </div>
                )}
                {source === 'type' && (
                  <div className="space-y-2">
                    <label htmlFor="sign-typed" className="block text-xs font-semibold text-ink-700 dark:text-zinc-200">Type your signature</label>
                    <input id="sign-typed" value={typed} maxLength={60} disabled={busy} onChange={(e) => setTyped(e.target.value)} autoComplete="name" className={fieldClass} data-testid="sign-typed" />
                    <div className="flex gap-2">
                      {TYPE_FONTS.map((font) => (
                        <button key={font.id} type="button" onClick={() => setTypedFont(font.id)} aria-pressed={typedFont === font.id}
                          className={`focus-ring rounded-lg border px-2.5 py-1 text-sm ${typedFont === font.id ? 'border-brand-500 ring-1 ring-brand-500' : 'border-black/10 dark:border-white/10'} text-ink-800 dark:text-zinc-100`}
                          style={{ fontFamily: font.css, fontStyle: font.id === 'italic' ? 'italic' : undefined }}>{font.label}</button>
                      ))}
                    </div>
                  </div>
                )}
                {source === 'upload' && (
                  <div className="space-y-1">
                    <label htmlFor="sign-upload" className="block text-xs font-semibold text-ink-700 dark:text-zinc-200">Signature image (PNG or JPEG)</label>
                    <input id="sign-upload" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={(e) => void onUpload(e.target.files?.[0])}
                      className="block w-full text-xs text-ink-700 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:text-zinc-200" data-testid="sign-upload" />
                    <p className="text-xs text-ink-500 dark:text-zinc-400">A light background is made transparent. The image stays in your browser until you sign.</p>
                    {uploadError && <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{uploadError}</p>}
                  </div>
                )}
                <fieldset className="space-y-2" disabled={busy}>
                  <legend className="mb-1 text-xs font-semibold text-ink-700 dark:text-zinc-200">Details under the signature</legend>
                  <label className="flex items-center gap-2 text-xs text-ink-700 dark:text-zinc-200">
                    <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="h-4 w-4 accent-brand-600" data-testid="sign-show-name" /> Name
                  </label>
                  {showName && <input aria-label="Name to show" value={signerName} maxLength={80} onChange={(e) => setSignerName(e.target.value)} autoComplete="name" className={fieldClass} data-testid="sign-name" />}
                  <label className="flex items-center gap-2 text-xs text-ink-700 dark:text-zinc-200">
                    <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} className="h-4 w-4 accent-brand-600" data-testid="sign-show-date" /> Date
                  </label>
                  {showDate && <input aria-label="Date to show" value={dateText} maxLength={40} onChange={(e) => setDateText(e.target.value)} className={fieldClass} data-testid="sign-date" />}
                </fieldset>
              </div>
            ) : (
              <div className="space-y-4" data-testid="sign-certificate-options">
                <div>
                  <span className="mb-1 block text-xs font-semibold text-ink-700 dark:text-zinc-200">Signing certificate (.pfx or .p12)</span>
                  {certFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-xs dark:border-white/10" data-testid="sign-cert-chosen">
                      <span className="flex min-w-0 items-center gap-2 text-ink-800 dark:text-zinc-100"><FileKey2 className="h-4 w-4 shrink-0 text-brand-600" aria-hidden /><span className="truncate">{certFile.name}</span></span>
                      <button type="button" disabled={busy} onClick={() => { setCertFile(null); setPassword(''); if (certInputRef.current) certInputRef.current.value = ''; }}
                        className="focus-ring rounded p-1 text-ink-500 hover:text-rose-600" aria-label="Remove certificate"><X className="h-3.5 w-3.5" aria-hidden /></button>
                    </div>
                  ) : (
                    <input ref={certInputRef} type="file" accept=".pfx,.p12,application/x-pkcs12" disabled={busy} onChange={(e) => onCertificate(e.target.files?.[0])}
                      aria-label="Signing certificate file"
                      className="block w-full text-xs text-ink-700 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:text-zinc-200" data-testid="sign-cert" />
                  )}
                  {certError && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert" data-testid="sign-cert-error">{certError}</p>}
                </div>
                <PasswordField label="Certificate password" value={password} onChange={setPassword} error={null} disabled={busy} testId="sign-cert-password"
                  hint="Leave empty if the file has no password. It is used once and never stored." />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div>
                    <label htmlFor="sign-reason" className="mb-1 block text-xs font-semibold text-ink-700 dark:text-zinc-200">Reason (optional)</label>
                    <input id="sign-reason" value={reason} maxLength={120} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I approve this document" className={fieldClass} data-testid="sign-reason" />
                  </div>
                  <div>
                    <label htmlFor="sign-location" className="mb-1 block text-xs font-semibold text-ink-700 dark:text-zinc-200">Location (optional)</label>
                    <input id="sign-location" value={location} maxLength={80} disabled={busy} onChange={(e) => setLocation(e.target.value)} className={fieldClass} data-testid="sign-location" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-700 dark:text-zinc-200">
                  <input type="checkbox" checked={visibleStamp} disabled={busy} onChange={(e) => setVisibleStamp(e.target.checked)} className="h-4 w-4 accent-brand-600" data-testid="sign-visible" />
                  Show the signature on the page
                </label>
                <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200" data-testid="sign-trust-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>A valid signature only shows the document hasn&apos;t changed since signing. Whether readers trust <em>who</em> signed depends on your certificate: self-signed certificates show as untrusted in Adobe Acrobat and other readers. The signing time comes from Doxera&apos;s server clock, not a trusted timestamp service.</span>
                </div>
                <div className="flex gap-2.5 rounded-xl border border-black/[0.07] bg-black/[0.02] p-3 text-xs leading-relaxed text-ink-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-zinc-300">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
                  <span>Your certificate and password are sent encrypted, used once to sign, and discarded. They are never stored, and the signature is checked before you can download the PDF.</span>
                </div>
              </div>
            )}

            {existingFields > 0 && (
              <label className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-900 dark:text-amber-200" data-testid="sign-existing">
                <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" data-testid="sign-existing-ack" />
                <span>This PDF already contains {existingFields} signature field{existingFields === 1 ? '' : 's'}. Existing signatures are kept unchanged, but readers will show that the document changed after they were made. I want to continue.</span>
              </label>
            )}

            <SubmitPanel tone="brand" icon={mode === 'visual' ? PenLine : FileKey2} busy={busy} disabled={!ready} onSubmit={() => void submit()}
              label={mode === 'visual' ? 'Add visual signature' : 'Sign with certificate'} busyLabel="Signing…" testIdPrefix="sign"
              summary={ready
                ? <span className="text-ink-700 dark:text-zinc-200">{mode === 'visual' ? `Visual signature on page ${placement?.page}.` : visibleStamp ? `Certificate signature, visible on page ${placement?.page}.` : 'Invisible certificate signature.'} You will get {signedFileName(file.name)}.</span>
                : <span className="text-ink-500 dark:text-zinc-400">{ackNeeded ? 'Confirm the note about existing signatures to continue.' : mode === 'visual' ? 'Draw, type or upload your signature to continue.' : 'Choose your certificate file to continue.'}</span>} />
          </aside>
        </div>
      )}
    </section>
  );
}
