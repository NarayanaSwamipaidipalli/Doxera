"""HTML to PDF.

The HTML is laid out by WeasyPrint, a print-CSS engine: @page size and margins, page breaks, tables (header
rows repeat across pages), flexbox, grid, inline SVG, and images and fonts embedded as data: URLs. Pages are
A4 portrait unless the document's @page rule says otherwise.

Uploaded HTML is untrusted, so:
- Nothing runs: WeasyPrint has no JavaScript engine; scripts, event handlers and javascript: links never execute.
- Nothing is fetched: every stylesheet, @import, image, font, SVG reference, attachment and <base href> goes
  through a fetcher that serves data: URLs only. http(s), file and relative URLs are refused, so a document
  cannot reach internal services, the internet, the worker's files or /proc. Those resources are left out.
- Isolation and limits: rendering runs in its own process with no credentials in its environment, a private
  temporary directory, sockets disabled, and CPU, memory, output-size, page-count and wall-clock limits.
- The content is checked before rendering (the upload's declared type comes from the client): binary files
  such as PDFs, Office documents, archives and images are refused with a message saying what they are.
"""
from __future__ import annotations

import json
import logging
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pymupdf

from app.config import settings
from .split_tools import UserFacingError

logger = logging.getLogger(__name__)

MAX_HTML_BYTES = 50 * 1024 * 1024  # the limit shown for HTML to PDF; the API enforces it too
MAX_PAGES = 2000
MAX_OUTPUT_BYTES = 512 * 1024 * 1024
APP_ROOT = Path(__file__).resolve().parents[2]
_BOOTSTRAP = ("import sys; sys.path.insert(0, sys.argv.pop(1)); "
              "from app.processors.html_render import main; sys.exit(main(sys.argv))")

NOT_HTML = "This file isn't an HTML document. Choose an .html or .htm file saved from a browser or an editor."
_SIGNATURES = (
    (b"%PDF-", "This file is already a PDF, not an HTML document. Choose the .html or .htm file you want to convert."),
    (b"PK\x03\x04", "This file is a ZIP archive or an Office document, not an HTML document. Use Word, Excel or "
                    "PowerPoint to PDF for Office files."),
    (b"\xd0\xcf\x11\xe0", "This file is an older Office document, not an HTML document. Use Word, Excel or "
                          "PowerPoint to PDF for Office files."),
    (b"\x89PNG\r\n\x1a\n", "This file is an image, not an HTML document. Use Image to PDF for pictures."),
    (b"\xff\xd8\xff", "This file is an image, not an HTML document. Use Image to PDF for pictures."),
    (b"GIF87a", "This file is an image, not an HTML document. Use Image to PDF for pictures."),
    (b"GIF89a", "This file is an image, not an HTML document. Use Image to PDF for pictures."),
    (b"\x1f\x8b", "This file is a compressed archive, not an HTML document. Extract it and choose the .html file."),
)

TOO_SLOW = ("This HTML file took too long to convert. Simplify the page or split it into smaller files, "
            "then try again.")
TOO_BIG = "This HTML file is too large or complex to convert. Split it into smaller files, then try again."


def check_html_input(input_path: str) -> None:
    """Refuses empty, oversized and binary files before a renderer is started."""
    size = os.path.getsize(input_path)
    if size > MAX_HTML_BYTES:
        raise UserFacingError("HTML files can be up to 50 MB.")
    with open(input_path, "rb") as handle:
        data = handle.read()
    if not data.strip():
        raise UserFacingError("This HTML file is empty.")
    head = data[:64].lstrip()
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        raise UserFacingError(_SIGNATURES[3][1])
    for signature, message in _SIGNATURES:
        if head.startswith(signature):
            raise UserFacingError(message)
    utf16 = data.startswith((b"\xff\xfe", b"\xfe\xff"))
    if not utf16 and b"\x00" in data[:65536]:
        raise UserFacingError(NOT_HTML)


def _renderer_environment(scratch: Path) -> dict:
    # The renderer needs no API, storage or queue credentials, so none are passed on.
    cache = scratch / "cache"
    cache.mkdir(exist_ok=True)
    return {
        "PATH": os.environ.get("PATH", os.defpath), "HOME": str(scratch), "TMPDIR": str(scratch),
        "XDG_CACHE_HOME": str(cache), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
    }


def _kill(process: subprocess.Popen) -> None:
    if os.name != "nt":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    else:  # pragma: no cover
        process.kill()


def _error_type(stderr: bytes) -> str:
    """The exception class name the renderer printed, for the log. Its message is not logged: it could quote
    the user's document."""
    lines = [line for line in (stderr or b"").decode("utf-8", "replace").splitlines() if line.strip()]
    name = lines[-1].split(":", 1)[0].strip() if lines else ""
    return f", {name}" if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,80}", name) else ""


def _failure_message(returncode: int) -> str:
    from .html_render import EXIT_OUT_OF_MEMORY, EXIT_TOO_MANY_PAGES

    if returncode == EXIT_TOO_MANY_PAGES:
        return (f"The PDF would have more than {MAX_PAGES:,} pages. Split the HTML into smaller files, "
                "then try again.")
    if returncode in (-getattr(signal, "SIGXCPU", 24), -signal.SIGKILL):
        return TOO_SLOW
    if returncode == -getattr(signal, "SIGXFSZ", 25):
        return ("The PDF would be larger than 512 MB. Reduce the size of embedded images or split the HTML "
                "into smaller files.")
    if returncode in (EXIT_OUT_OF_MEMORY, -signal.SIGSEGV, -signal.SIGABRT, -getattr(signal, "SIGBUS", 7)):
        return TOO_BIG
    return "This HTML file could not be converted. Check that it is a valid HTML document, then try again."


def convert_html_to_pdf(input_path: str, output_path: str, title: str = "") -> dict:
    """Renders an uploaded HTML file to `output_path`. Raises UserFacingError for anything the user can fix."""
    check_html_input(input_path)
    started = time.monotonic()
    timeout = settings.HTML_CONVERSION_TIMEOUT_SECONDS
    options = {
        "memory_bytes": settings.HTML_CONVERSION_MEMORY_MB * 1024 * 1024,
        "cpu_seconds": timeout, "max_output_bytes": MAX_OUTPUT_BYTES, "max_pages": MAX_PAGES,
        "title": (title or "").strip()[:200],
    }
    target = Path(output_path).resolve()
    with tempfile.TemporaryDirectory(prefix="pdfforge-html-", dir=target.parent) as temporary:
        scratch = Path(temporary)
        rendered = scratch / "rendered.pdf"
        command = [sys.executable, "-I", "-B", "-W", "ignore", "-c", _BOOTSTRAP, str(APP_ROOT),
                   str(Path(input_path).resolve()), str(rendered), json.dumps(options)]
        try:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=scratch,
                                       env=_renderer_environment(scratch), start_new_session=os.name != "nt")
        except OSError:
            raise RuntimeError("The HTML renderer could not be started") from None
        try:
            stdout, stderr = process.communicate(timeout=timeout + 10)
        except subprocess.TimeoutExpired:
            _kill(process)
            process.communicate()
            logger.warning("HTML to PDF timed out after %ss", timeout + 10)
            raise UserFacingError(TOO_SLOW) from None

        if process.returncode != 0:
            logger.warning("HTML to PDF renderer failed (exit %s%s)", process.returncode, _error_type(stderr))
            raise UserFacingError(_failure_message(process.returncode))
        try:
            stats = json.loads(stdout.decode("utf-8").strip().splitlines()[-1])
            with pymupdf.open(rendered) as document:
                if not document.is_pdf or document.page_count < 1 or document.page_count != stats["pages"]:
                    raise ValueError("unexpected output")
        except Exception:
            raise RuntimeError("The HTML renderer did not produce a valid PDF") from None
        os.replace(rendered, target)

    stats["seconds"] = round(time.monotonic() - started, 2)
    logger.info("HTML to PDF: %s pages in %ss; %s external or relative resources left out",
                stats["pages"], stats["seconds"], stats.get("blocked", 0) + stats.get("relative", 0))
    return stats
