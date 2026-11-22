import React, { useState, useEffect, useRef } from "react";
import { submit } from "./submit";
import type { Tool } from "./catalog";
import { SplitPdfWorkspace } from "@/components/tools/split/SplitPdfWorkspace";
import { DeletePagesWorkspace } from "@/components/tools/delete/DeletePagesWorkspace";
import { ExtractPagesWorkspace } from "@/components/tools/extract/ExtractPagesWorkspace";
import { ReorderPagesWorkspace } from "@/components/tools/reorder/ReorderPagesWorkspace";
import { PdfToPptWorkspace } from "@/components/tools/ppt/PdfToPptWorkspace";
import { EncryptPdfWorkspace } from "@/components/tools/encrypt/EncryptPdfWorkspace";
import { BatesWorkspace } from "@/components/tools/bates/BatesWorkspace";
import { RedactWorkspace } from "@/components/tools/redact/RedactWorkspace";
import { SignWorkspace } from "@/components/tools/sign/SignWorkspace";
import { SignatureReport } from "@/components/tools/sign/SignatureReport";
import { CompareWorkspace } from "@/components/tools/compare/CompareWorkspace";
import {
  UploadCloud,
  FileText,
  ArrowLeft,
  Trash2,
  MoveUp,
  MoveDown,
  RotateCw,
  Settings2,
  Download,
  CheckCircle2,
} from "lucide-react";

export function ToolPage({ tool, initial }: { tool: Tool; initial?: File }) {
  const [files, setFiles] = useState<File[]>(initial ? [initial] : []);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof submit>
  > | null>(null);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  function reset() {
    setFiles([]);
    setResult(null);
    setError("");
  }
  function accept(incoming: File[]) {
    if (!incoming.length || busy) return;
    const next = tool.multipleFiles ? [...files, ...incoming] : [incoming[0]];
    if (
      next.length > tool.max ||
      next.some((f) => !f.size || f.size > 50_000_000) ||
      next.reduce((n, f) => n + f.size, 0) > 100_000_000
    ) {
      setError(
        "Choose up to " + tool.max + " file(s), 50 MB each and 100 MB total.",
      );
      return;
    }
    if (
      next.some(
        (f) =>
          !tool.acceptedTypes.includes(
            "." + f.name.split(".").pop()?.toLowerCase(),
          ),
      )
    ) {
      setError("Supported files: " + tool.acceptedTypes.join(", "));
      return;
    }
    setFiles(next);
    setResult(null);
    setError("");
  }
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    accept(Array.from(e.target.files || []));
    e.target.value = "";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    accept(Array.from(e.dataTransfer.files));
  };
  const handleRemoveFile = (i: number) => {
    setResult(null);
    setError("");
    setFiles(files.filter((_, n) => n !== i));
  };
  const handleMoveFile = (i: number, dir: "up" | "down") => {
    const ordered = [...files];
    const j = i + (dir === "up" ? -1 : 1);
    if (j >= 0 && j < files.length) {
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      setFiles(ordered);
      setResult(null);
    }
  };
  function download() {
    if (result) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.name;
      a.click();
    }
  }
  const [compressionLevel, setCompressionLevel] = useState<
    "low" | "medium" | "high" | "extreme"
  >("medium");
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkOpacity, setWatermarkOpacity] = useState(30);
  const [rotationDegrees, setRotationDegrees] = useState(90);
  const [unlockPassword, setUnlockPassword] = useState("");

  const [ocrLanguage, setOcrLanguage] = useState("eng");

  // Metadata Editor States
  const [metaTitle, setMetaTitle] = useState("");
  const [metaAuthor, setMetaAuthor] = useState("");
  const [metaSubject, setMetaSubject] = useState("");
  const [metaKeywords, setMetaKeywords] = useState("");

  async function run(settings: Record<string, any> = {}) {
    if (running.current) return;
    if (files.length < tool.min || files.length > tool.max) {
      setError("Choose " + tool.min + " to " + tool.max + " files.");
      return;
    }
    let option = "";
    switch (tool.id) {
      case "compress":
        option = compressionLevel;
        break;
      case "rotate":
        option = String(rotationDegrees);
        break;
      case "watermark":
        option = watermarkText;
        settings = { watermarkOpacity: watermarkOpacity / 100 };
        break;
      case "encrypt":
      case "protect":
        option = settings.password;
        settings = { encryption: settings.encryption };
        break;
      case "decrypt":
        option = unlockPassword;
        setUnlockPassword("");
        break;
      case "ocr":
        option = ocrLanguage;
        break;
      case "metadata":
        settings = {
          title: metaTitle,
          author: metaAuthor,
          subject: metaSubject,
          keywords: metaKeywords,
        };
        break;
    }
    running.current = true;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      setResult(await submit(tool, files, option, settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen px-4 py-12 sm:px-6 lg:px-8">
      <div
        className={`${["split", "delete-pages", "extract-pages", "reorder-pages", "pdf-to-ppt", "encrypt", "protect", "bates", "redact", "sign"].includes(tool.id) ? "max-w-6xl" : "max-w-4xl"} mx-auto`}
      >
        {/* Navigation Breadcrumb */}
        <div className="mb-6">
          <a
            href="/#tools"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 dark:text-ink-400 dark:text-zinc-500 hover:text-ink-900 dark:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Tools
          </a>
        </div>

        {/* Tool Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-start gap-4">
            <div
              className={`w-14 h-14 rounded-2xl bg-gradient-to-tr ${tool.accentColor} text-white flex items-center justify-center shadow-md shadow-blue-500/10 shrink-0`}
            >
              <FileText className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-semibold text-ink-900 dark:text-white tracking-tight">
                  {tool.name}
                </h1>
              </div>
              <p className="text-sm text-ink-500 dark:text-ink-400 dark:text-zinc-500">
                {tool.description}
              </p>
            </div>
          </div>
        </div>
        <div className="surface mb-8 rounded-3xl border border-black/[0.07] p-6 shadow-card dark:border-white/[0.07] dark:shadow-card-dark sm:p-8">
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm"
            >
              {error}
            </p>
          )}
          {(!result || tool.id === "compare") && (
            <fieldset disabled={busy} className="min-w-0">
              {/* File Upload Zone */}
              {files.length === 0 ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
                    isDragging
                      ? "scale-[1.01] border-brand-500 bg-brand-500/[0.07] shadow-glow"
                      : "border-black/15 bg-black/[0.02] hover:border-brand-500/50 dark:border-white/15 dark:bg-white/[0.02]"
                  }`}
                >
                  <input
                    type="file"
                    multiple={tool.multipleFiles}
                    accept={tool.acceptedTypes.join(",")}
                    onChange={handleFileChange}
                    aria-label={`Select ${tool.multipleFiles ? "files" : "a file"} for ${tool.name}`}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <div
                    className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 transition-transform duration-200 dark:text-brand-300 ${
                      isDragging ? "scale-110" : ""
                    }`}
                  >
                    <UploadCloud className="h-7 w-7" aria-hidden />
                  </div>
                  <h3 className="mb-1 text-base font-semibold text-ink-900 dark:text-white">
                    {isDragging
                      ? "Drop to upload"
                      : `Select or drop ${tool.multipleFiles ? "files" : "a file"} to process`}
                  </h3>
                  <p className="mb-4 text-xs text-ink-500 dark:text-ink-400 dark:text-zinc-500">
                    Accepts {tool.acceptedTypes.join(", ")} &middot; 50 MB per
                    file
                  </p>
                  <button
                    type="button"
                    className="px-5 py-2 rounded-full bg-blue-600 text-white text-xs font-medium shadow-sm hover:bg-blue-700 pointer-events-none"
                  >
                    Choose from Device
                  </button>
                </div>
              ) : tool.id === "split" ? (
                <SplitPdfWorkspace
                  file={files[0]}
                  busy={busy}
                  onSplit={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "delete-pages" ? (
                <DeletePagesWorkspace
                  file={files[0]}
                  busy={busy}
                  onDelete={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "extract-pages" ? (
                <ExtractPagesWorkspace
                  file={files[0]}
                  busy={busy}
                  onExtract={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "reorder-pages" ? (
                <ReorderPagesWorkspace
                  file={files[0]}
                  busy={busy}
                  onReorder={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "pdf-to-ppt" ? (
                <PdfToPptWorkspace
                  file={files[0]}
                  busy={busy}
                  onConvert={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "bates" ? (
                <BatesWorkspace
                  file={files[0]}
                  busy={busy}
                  onApply={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "redact" ? (
                <RedactWorkspace
                  file={files[0]}
                  busy={busy}
                  onRedact={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "sign" ? (
                <SignWorkspace
                  file={files[0]}
                  busy={busy}
                  onSign={run}
                  onRemoveFile={reset}
                />
              ) : ["encrypt", "protect"].includes(tool.id) ? (
                <EncryptPdfWorkspace
                  file={files[0]}
                  busy={busy}
                  onEncrypt={run}
                  onRemoveFile={reset}
                />
              ) : tool.id === "compare" && files.length === 2 ? (
                <CompareWorkspace
                  original={files[0]}
                  modified={files[1]}
                  busy={busy}
                  summary={result?.summary ?? null}
                  canCancel={false}
                  onCancel={() => {}}
                  onCompare={() => run()}
                  onReset={reset}
                  onDownload={download}
                />
              ) : (
                <div className="space-y-6">
                  {/* Selected Files List */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400 dark:text-zinc-500">
                        Selected Files ({files.length})
                      </h4>
                      {tool.multipleFiles && (
                        <label className="text-xs text-blue-600 font-medium cursor-pointer hover:underline">
                          + Add More Files
                          <input
                            type="file"
                            multiple
                            accept={tool.acceptedTypes.join(",")}
                            onChange={handleFileChange}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    <div className="space-y-2">
                      {files.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3.5 rounded-xl border border-black/[0.07] dark:border-white/[0.07] bg-black/[0.03] dark:bg-white/[0.04] text-xs"
                        >
                          <div className="flex items-center gap-3">
                            {tool.multipleFiles && (
                              <span className="w-5 h-5 rounded-full bg-black/[0.07] dark:bg-white/[0.09] text-ink-700 dark:text-zinc-200 flex items-center justify-center text-[10px] font-bold">
                                {idx + 1}
                              </span>
                            )}
                            <FileText className="w-4 h-4 text-ink-500 dark:text-ink-400 dark:text-zinc-500" />
                            <div>
                              <div className="font-medium text-ink-900 dark:text-white">
                                {file.name}
                              </div>
                              <div className="text-[10px] text-ink-500 dark:text-ink-400 dark:text-zinc-500">
                                {file.size < 1024
                                  ? `${file.size} B`
                                  : file.size < 1048576
                                    ? `${(file.size / 1024).toFixed(1)} KB`
                                    : `${(file.size / 1048576).toFixed(2)} MB`}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {tool.multipleFiles && files.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleMoveFile(idx, "up")}
                                  disabled={idx === 0}
                                  className="p-1 text-ink-400 dark:text-zinc-500 hover:text-ink-700 dark:text-zinc-200 disabled:opacity-20 transition-colors"
                                  title="Move Up"
                                >
                                  <MoveUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveFile(idx, "down")}
                                  disabled={idx === files.length - 1}
                                  className="p-1 text-ink-400 dark:text-zinc-500 hover:text-ink-700 dark:text-zinc-200 disabled:opacity-20 transition-colors"
                                  title="Move Down"
                                >
                                  <MoveDown className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(idx)}
                              className="text-ink-400 dark:text-zinc-500 hover:text-rose-600 p-1 transition-colors"
                              title="Remove File"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {tool.multipleFiles && (
                      <label
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                        className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-black/15 bg-black/[0.02] p-3 text-xs text-ink-600 transition-colors hover:border-brand-500/50 hover:bg-brand-500/[0.05] dark:border-white/15 dark:bg-white/[0.02] dark:text-ink-400 dark:text-zinc-500"
                      >
                        <UploadCloud className="w-4 h-4 text-ink-500 dark:text-ink-400 dark:text-zinc-500" />
                        <span>
                          + Add more files (click to browse or drop files)
                        </span>
                        <input
                          type="file"
                          multiple
                          accept={tool.acceptedTypes.join(",")}
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  {/* Tool Parameters Configuration */}
                  {[
                    "compress",
                    "watermark",
                    "rotate",
                    "decrypt",
                    "compare",
                    "metadata",
                    "ocr",
                  ].includes(tool.id) && (
                    <div className="pt-4 border-t border-black/[0.07] dark:border-white/[0.07]">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400 dark:text-zinc-500 mb-4 flex items-center gap-1.5">
                        <Settings2 className="w-3.5 h-3.5" /> Options &amp;
                        Settings
                      </h4>

                      {/* 1. Compress Tool */}
                      {tool.id === "compress" && (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {[
                            {
                              id: "low",
                              label: "Standard",
                              desc: "Light compression · 300 dpi",
                            },
                            {
                              id: "medium",
                              label: "Recommended",
                              desc: "Balance size and image quality · 200 dpi",
                            },
                            {
                              id: "high",
                              label: "High",
                              desc: "150 dpi · compact images",
                            },
                            {
                              id: "extreme",
                              label: "Extreme",
                              desc: "Same 150 dpi profile as High",
                            },
                          ].map((lvl) => (
                            <button
                              key={lvl.id}
                              type="button"
                              aria-pressed={compressionLevel === lvl.id}
                              onClick={() =>
                                setCompressionLevel(
                                  lvl.id as typeof compressionLevel,
                                )
                              }
                              className={`p-3 text-left rounded-xl border transition-all ${
                                compressionLevel === lvl.id
                                  ? "border-brand-500 bg-brand-500/10 ring-1 ring-brand-500 text-ink-900 dark:text-white"
                                  : "border-black/[0.07] dark:border-white/[0.07] hover:border-black/15 dark:border-white/15"
                              }`}
                            >
                              <div className="font-semibold text-xs text-ink-900 dark:text-white">
                                {lvl.label}
                              </div>
                              <div className="text-[10px] text-ink-500 dark:text-ink-400 dark:text-zinc-500 mt-0.5">
                                {lvl.desc}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 2. Watermark Tool */}
                      {tool.id === "watermark" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                              Watermark Text
                            </label>
                            <input
                              type="text"
                              value={watermarkText}
                              onChange={(e) => setWatermarkText(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                              Opacity ({watermarkOpacity}%)
                            </label>
                            <input
                              type="range"
                              min="10"
                              max="90"
                              value={watermarkOpacity}
                              onChange={(e) =>
                                setWatermarkOpacity(Number(e.target.value))
                              }
                              className="w-full mt-2"
                            />
                          </div>
                        </div>
                      )}

                      {/* 3. Split PDF */}
                      {/* 4. Rotate PDF */}
                      {tool.id === "rotate" && (
                        <div className="flex gap-2">
                          {[90, 180, 270].map((deg) => (
                            <button
                              key={deg}
                              type="button"
                              onClick={() => setRotationDegrees(deg)}
                              className={`px-4 py-2 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition-all ${
                                rotationDegrees === deg
                                  ? "border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-200 ring-1 ring-brand-500"
                                  : "border-black/[0.07] dark:border-white/[0.07] hover:border-black/15 dark:border-white/15"
                              }`}
                            >
                              <RotateCw className="w-3.5 h-3.5" /> Rotate {deg}°
                              Clockwise
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 8. Encrypt PDF and Password Protect PDF use EncryptPdfWorkspace (above). */}

                      {/* 9. Decrypt PDF */}
                      {tool.id === "decrypt" && (
                        <div>
                          <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                            Current Document Password
                          </label>
                          <input
                            type="password"
                            placeholder="Enter password to unlock and decrypt document"
                            value={unlockPassword}
                            onChange={(e) => setUnlockPassword(e.target.value)}
                            autoComplete="off"
                            className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring"
                          />
                          <p className="text-[11px] text-ink-400 dark:text-zinc-500 mt-1">
                            Decrypts and unlocks the PDF for unrestricted
                            printing and copying.
                          </p>
                        </div>
                      )}

                      {tool.id === "compare" && (
                        <p className="text-sm text-ink-600 dark:text-zinc-300">
                          Select exactly two PDFs, in order: Original, then
                          Modified. The comparison workspace opens when both are
                          selected.
                        </p>
                      )}

                      {/* 14. PDF Metadata Editor */}
                      {tool.id === "metadata" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                              Document Title
                            </label>
                            <input
                              type="text"
                              value={metaTitle}
                              onChange={(e) => setMetaTitle(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                              Author / Organization
                            </label>
                            <input
                              type="text"
                              value={metaAuthor}
                              onChange={(e) => setMetaAuthor(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                              Subject Matter
                            </label>
                            <input
                              type="text"
                              value={metaSubject}
                              onChange={(e) => setMetaSubject(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                              Search Keywords (Comma Separated)
                            </label>
                            <input
                              type="text"
                              value={metaKeywords}
                              onChange={(e) => setMetaKeywords(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring"
                            />
                          </div>
                        </div>
                      )}

                      {/* 15. OCR Multi-lingual Language Selector */}
                      {tool.id === "ocr" && (
                        <div className="max-w-md">
                          <label className="block text-xs font-medium text-ink-700 dark:text-zinc-200 mb-1">
                            OCR Document Primary Language
                          </label>
                          <select
                            value={ocrLanguage}
                            onChange={(e) => setOcrLanguage(e.target.value)}
                            className="w-full px-3 py-2 text-xs border border-black/[0.07] dark:border-white/[0.07] rounded-lg focus-ring bg-white/70 dark:bg-white/[0.06] text-ink-900 dark:text-white"
                          >
                            <option value="eng">English</option>
                            <option value="fra">French (Français)</option>
                            <option value="spa">Spanish (Español)</option>
                            <option value="deu">German (Deutsch)</option>
                            <option value="jpn">Japanese (日本語)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run()}
                      className="focus-ring rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white"
                    >
                      Execute {tool.name}
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
          )}
          {busy && (
            <p role="status" className="mt-4 text-sm">
              Processing your document…
            </p>
          )}
          {result && (
            <section
              aria-label="Result"
              className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5"
            >
              <h2 className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={20} />
                Your file is ready
              </h2>
              {tool.id === "compress" && (
                <p className="my-3 text-sm">
                  {(files[0].size / 1e6).toFixed(2)} MB →{" "}
                  {(result.size / 1e6).toFixed(2)} MB ·{" "}
                  {(100 * (1 - result.size / files[0].size)).toFixed(1)}% saved
                </p>
              )}
              {tool.id === "sign" && (
                <SignatureReport summary={result.summary} />
              )}
              <a
                href={result.url}
                download={result.name}
                className="focus-ring mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white"
              >
                <Download size={16} />
                Download {result.name.split(".").pop()?.toUpperCase()}
              </a>
              <button onClick={reset} className="focus-ring ml-4 text-sm">
                Start over
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
