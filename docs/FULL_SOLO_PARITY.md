# Doxera Solo RC3 tool comparison

The local catalog has **35 entries**. Solo enables **24**, labels **four imports Coming soon** and displays **seven unavailable AI entries**. RC3 is prepared for the password-protected synthetic trial. The native-parser review for a real-document launch remains open. [Office parser review](OFFICE_PARSER_UPDATE.md)

## How the editions were compared

The reference was the owner's local full checkout on `staging` at base commit `7173bbc`, including its working-tree fixes. The public solo baseline was `351f811`. The comparison used synthetic documents. In Docker, the full Celery task and real converters processed fixtures with in-memory storage transport, local cancellation state and synthetic signing inputs. The solo image ran Gunicorn, its HTTP gate, the application request handler and its restricted child process. Outputs were reopened with PDF, image, ZIP, Word, Excel or PowerPoint readers. These checks cover the reference worker and solo HTTP path; they do not require the full site's database or modify existing jobs.

A second Chromium pass opened all 35 original full-edition pages and loaded synthetic browser previews in its specialized workspaces. It allowed only read-only requests to the local frontend.

Python syntax-tree comparison found that every retained processor module matched the local checkout except `basic_tools.py`. Its only changed definitions were the scan-aware compression function and its two failure types. The solo request adapter accounts for the other output differences below.

The homepage, responsive tool layout, light/dark themes, Inter typeface, ten specialized React workspaces and PDF preview controls come from the full edition. Solo builds them with Vite and serves scripts, fonts and PDF.js from the same origin. The result arrives in the processing request. Solo omits accounts, checkout, job history and polling. The trial gate uses HTTP Basic with the existing owner password. Original filenames stay out of worker paths, so attachments and names inside archives use generic names. Downloads remain in browser memory until the user leaves or starts over.

The shared limits are **50 decimal MB per file**, **100 MB per request**, **150 pages per PDF** and up to **eight inputs** for multi-file operations, subject to each tool's limits. Requests use CSRF protection, an IP rate limit, a single conversion slot and a worker time limit. The application unlinks temporary paths on completion and sweeps abandoned files before one hour. The rate limiter uses an ephemeral SQLite counter file. No account database, object store, message broker or payment service is required.

## Tool-by-tool results

| Tool | Local full behavior | Solo result and remaining difference |
|---|---|---|
| Compress PDF | Standard, Recommended and Extreme reduce embedded images using pixel-size limits. | **PASS.** Keeps the solo scan fix. Low/Standard targets 300 dpi, Medium/Recommended 200 dpi and High/Extreme share 150 dpi. Shows original size, result size and savings. A file that cannot shrink produces a message. |
| Merge PDF | Merge multiple PDFs in user-selected order and preserve supported bookmarks. | **PASS.** Same merge function and reorder controls. Two to eight files. |
| Split PDF | Preview and select pages, split every page, define output groups, or split every N pages. | **PASS.** Shared selector and range engine. Also accepts a comma-separated list with one PDF per range. One result downloads as PDF, multiple results as ZIP. |
| Rotate PDF | Choose clockwise rotation of 90°, 180° or 270°. The full worker can additionally take page selections through its API. | **PASS.** The website exposes the same whole-document rotation controls. |
| Delete Pages | Preview, select and remove pages. Preserve valid surviving bookmarks and destinations. | **PASS.** Same strict selection and navigation processors. |
| Extract Pages | Extract a selection to one PDF, separate PDFs, or custom groups. | **PASS.** Same workspace, modes and validation. |
| Reorder Pages | Drag page thumbnails into a new order. The worker validates a complete permutation. | **PASS.** Same workspace and page-order processor. |
| PDF to Word | Produces a DOCX with the shared layout and conversion engine. | **PASS.** The DOCX contained the fixture text. |
| PDF to Excel | Extracts tabular content into UTF-8 CSV. | **PASS.** The same extracted cells are written as literal text to an XLSX workbook. |
| PDF to PowerPoint | Choose visual slides or editable slides and inspect the source pages. | **PASS.** Same workspace and converter. Solo uses a generic document title. |
| Word to PDF | Synthetic Office import produced a PDF with the fixture text. | **Coming soon.** GET and POST both denied. |
| Excel to PDF | Synthetic spreadsheet import produced a PDF with the fixture text. | **Coming soon.** GET and POST both denied. |
| PowerPoint to PDF | Synthetic presentation import produced a PDF with the fixture text. | **Coming soon.** GET and POST both denied. |
| Image to PDF | Order and combine images into a PDF. | **PASS.** Accepts JPEG, PNG and WebP, up to eight images. |
| PDF to Image | Exports pages as PNG, bundling multiple images into ZIP. | **PASS.** Same format; generated images decoded with visible content. |
| HTML to PDF | Synthetic HTML rendered into a readable PDF. | **Coming soon.** GET and POST both denied. |
| Watermark PDF | Apply text and choose opacity. | **PASS.** Same text/opacity controls and processor. |
| Encrypt PDF | Set a document password and choose AES-128 or AES-256. | **PASS.** Real output required a password and opened with the supplied one. |
| Password Protect PDF | Uses the encryption workspace and processor. | **PASS.** Both public catalog names lead to the same protection options. |
| Unlock PDF | Remove encryption with the current password. | **PASS.** The resulting PDF opened without a password. |
| Bates Numbering | Preview numbering, formatting, position and page selection. | **PASS.** Shared single-document workspace and numbering engine. |
| Redact PDF | Mark areas and searchable terms on the preview and apply permanent redaction. | **PASS.** Same editor and processor. Reopened fixture omitted the targeted term and preserved the control text. |
| Sign PDF | Apply a visual signature or use a PKCS#12 certificate with a verification report. | **PASS.** Both modes return the signed PDF and report. Solo uses the server clock and offline verification. |
| Compare PDF | View two documents, highlights, a change list and a downloadable report. Queued jobs can be cancelled. | **PASS.** Same comparison workspace and PDF report. Solo runs synchronously and omits the queue-cancel action. |
| Metadata Editor | Edit title, author, subject and keywords. | **PASS.** All four values were verified in the downloaded file. |
| Repair PDF | Rewrite and reopen the PDF with the repair processor. | **PASS.** Synthetic output retained readable page text. |
| OCR PDF | Make scans searchable using English, German, French, Spanish or Japanese. | **PASS.** Same OCR worker and five language options. The solo HTTP fixture verified independently extractable English text. |
| Batch Processing | Full worker routes batch to compression of the first input. | **PASS.** Solo compresses each input separately and returns them together in a ZIP. |
| AI PDF Summary | Catalog entry; the tested full worker rejected its slug as unsupported. | Unavailable. GET and POST denied. |
| PDF Chat | Catalog entry; worker rejected its slug. | Unavailable. GET and POST denied. |
| Document Q&A | Catalog entry; worker rejected its slug. | Unavailable. GET and POST denied. |
| Invoice Extraction | Catalog entry; worker rejected its slug. | Unavailable. GET and POST denied. |
| Contract Analysis | Catalog entry; worker rejected its slug. | Unavailable. GET and POST denied. |
| AI Resume & CV Parser | Catalog entry; worker rejected its slug. | Unavailable. GET and POST denied. |
| Document Translator | Catalog entry; worker rejected its slug. | Unavailable. GET and POST denied. |

## Docker verification

- **Full reference:** 396 API, 206 frontend and 270 worker tests passed. Equivalent synthetic fixtures produced readable output for all 28 supported full-worker routes. The seven AI routes reached the worker's unsupported-tool branch.
- **Solo:** 117 frontend/PDF tests and 11 safeguard/compression tests passed. Both the compatibility form and the structured browser request completed all 24 tools. The smoke client also checked GET and POST on all eleven disabled routes. The large-scan regression requires at least 50% reduction at High and checks each output image's encoding and DPI.
- **Split:** Reopened PDFs and ZIP members contained the exact expected page labels for 1–3 and 4–8, a single range, and fixed groups of three including the two-page remainder. Reversed, zero and out-of-range selections returned HTTP 422.
- **Browser:** Chromium opened every form, rendered real thumbnails, validated ranges, downloaded PDF and ZIP attachments, reordered merge inputs, selected the compression levels and rendered a Compare report. The suite also checked mobile controls, source and privacy links, disabled cards, script errors and external requests.
- **Access and packaging:** The tested image runs without an account API, payment integration, broker or object store. The released browser bundle serves third-party notices and the tagged corresponding source. The encrypted file in the frontend test fixtures was locally generated from a single synthetic page with disposable, unrecorded passwords.

Gitleaks 8.30.1 reported zero findings in the staged patch and in a clean export of the complete release tree. The path and file-signature checks found no environment files, database dumps, backups or credential stores.

The Docker checks apply to RC3. Hosted verification of RC3 starts after the owner manually deploys that revision. [Tagged source download](https://github.com/NarayanaSwamipaidipalli/Doxera/archive/refs/tags/solo-v1.0.0-rc.3.tar.gz)
