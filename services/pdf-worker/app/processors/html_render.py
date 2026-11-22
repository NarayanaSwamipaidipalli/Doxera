"""Renderer process for HTML to PDF. Started by html_tools.convert_html_to_pdf; never imported by the worker.

    python -I -B -c <bootstrap> <app root> <input.html> <output.pdf> <options json>

Applies its resource limits and disables networking before WeasyPrint is imported, then prints one JSON line
with statistics. Exit codes: 0 done, 3 too many pages, 4 out of memory, 5 rendering failed, 2 bad usage.
"""
from __future__ import annotations

import codecs
import json
import logging
import re
import sys

try:  # Unix only; the worker runs on Linux.
    import resource
except ImportError:  # pragma: no cover
    resource = None

EXIT_TOO_MANY_PAGES = 3
EXIT_OUT_OF_MEMORY = 4
EXIT_RENDER_FAILED = 5

_META_CHARSET = re.compile(rb"""<meta[^>]+?charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)""", re.IGNORECASE)


def apply_limits(memory_bytes: int, cpu_seconds: int, max_output_bytes: int) -> None:
    if resource is None:  # pragma: no cover
        return
    for kind, soft, hard in (
        (resource.RLIMIT_CORE, 0, 0),
        (resource.RLIMIT_AS, memory_bytes, memory_bytes),
        (resource.RLIMIT_CPU, cpu_seconds, cpu_seconds + 5),
        (resource.RLIMIT_FSIZE, max_output_bytes, max_output_bytes),
    ):
        resource.setrlimit(kind, (soft, hard))


def disable_network() -> None:
    """Backstop for the resource fetcher: no Python code in this process can resolve names or connect."""
    import socket

    def refuse(*_args, **_kwargs):
        raise OSError("Network access is disabled while rendering HTML")

    socket.getaddrinfo = refuse
    socket.create_connection = refuse
    for name in ("connect", "connect_ex", "sendto", "sendmsg"):
        setattr(socket.socket, name, refuse)


def choose_encoding(data: bytes):
    """A byte-order mark wins (the parser reads it), then a declared charset anywhere near the top, then UTF-8
    when the bytes are valid UTF-8 (browsers detect this too), otherwise the HTML default (windows-1252)."""
    import webencodings

    if data.startswith((codecs.BOM_UTF8, codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return None
    match = _META_CHARSET.search(data[:65536])
    if match:
        label = match.group(1).decode("ascii", "ignore")
        if webencodings.lookup(label) is not None:
            return label
    try:
        data.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return None


def make_fetcher():
    from weasyprint.urls import URLFetcher

    class InlineResourcesOnly(URLFetcher):
        """Serves data: URLs only. http(s), file, ftp and every other URL is refused, so a document cannot
        reach the network, internal services or the worker's files; the resource is simply left out."""

        def __init__(self):
            super().__init__(timeout=1, allowed_protocols={"data"}, allow_redirects=False)
            self.blocked = 0

        def fetch(self, url, headers=None):
            if not str(url).lower().startswith("data:"):
                self.blocked += 1
                raise ValueError("External resources are not loaded")
            return super().fetch(url, headers)

    return InlineResourcesOnly()


def fix_min_height_absolute_positioning() -> bool:
    """Work around a WeasyPrint 70 layout bug, in this process only.

    A position:relative box lays out its absolutely positioned descendants before min-height is applied
    (weasyprint/layout/block.py, block_container_layout), so an element anchored with `bottom:` inside a box
    sized by min-height (a full-page section with a footer, for example) lands under the content instead of
    at the bottom of the box. Browsers use the box's final height. While those descendants are laid out, the
    box is given the height it ends up with anyway: max(min(height, max-height), min-height) = min-height
    when that is larger. Only boxes that fit on the current page are adjusted, so boxes split across pages
    keep WeasyPrint's own handling. Only applied to the version it was verified with.
    """
    import weasyprint
    from weasyprint.layout import block

    if not weasyprint.__version__.startswith("70.") or getattr(block, "_doxera_min_height_fix", False):
        return False
    original = block.absolute_layout

    def absolute_layout(context, placeholder, containing_block, fixed_boxes, bottom_space, skip_stack):
        box = containing_block
        height, min_height = getattr(box, "height", "auto"), getattr(box, "min_height", 0)
        if isinstance(height, (int, float)) and isinstance(min_height, (int, float)) and min_height > height:
            bottom = box.position_y + (box.margin_height() - height) + min_height
            if bottom <= context.page_bottom - bottom_space + 0.01:
                box.height = min_height
                try:
                    return original(context, placeholder, box, fixed_boxes, bottom_space, skip_stack)
                finally:
                    box.height = height
        return original(context, placeholder, containing_block, fixed_boxes, bottom_space, skip_stack)

    block.absolute_layout = absolute_layout
    block._doxera_min_height_fix = True
    return True


class WarningCounter(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.warnings = 0
        self.relative = 0

    def emit(self, record):
        self.warnings += 1
        if "Relative URI reference" in record.getMessage():
            self.relative += 1


def render(input_path: str, output_path: str, options: dict) -> dict:
    from weasyprint import HTML

    fix_min_height_absolute_positioning()
    counter = WarningCounter()
    for name in ("weasyprint", "weasyprint.progress"):
        log = logging.getLogger(name)
        log.handlers[:] = [counter] if name == "weasyprint" else []
        log.propagate = False
        log.setLevel(logging.WARNING)

    with open(input_path, "rb") as handle:
        data = handle.read()
    fetcher = make_fetcher()
    document = HTML(string=data, encoding=choose_encoding(data), base_url=None, url_fetcher=fetcher,
                    media_type="print").render(presentational_hints=True)
    pages = len(document.pages)
    if pages > options["max_pages"]:
        return {"pages": pages, "too_many_pages": True}
    if not (document.metadata.title or "").strip() and options.get("title"):
        document.metadata.title = options["title"]
    document.write_pdf(output_path)
    return {"pages": pages, "blocked": fetcher.blocked, "relative": counter.relative, "warnings": counter.warnings}


def main(argv) -> int:
    if len(argv) != 4:
        print("usage: <input.html> <output.pdf> <options json>", file=sys.stderr)
        return 2
    input_path, output_path, raw_options = argv[1:]
    options = json.loads(raw_options)
    apply_limits(options["memory_bytes"], options["cpu_seconds"], options["max_output_bytes"])
    disable_network()
    try:
        stats = render(input_path, output_path, options)
    except MemoryError:
        return EXIT_OUT_OF_MEMORY
    except Exception as exc:  # WeasyPrint raises many types; the parent reports one clear message.
        print(f"{type(exc).__name__}: {str(exc)[:300]}", file=sys.stderr)
        return EXIT_RENDER_FAILED
    print(json.dumps(stats))
    return EXIT_TOO_MANY_PAGES if stats.get("too_many_pages") else 0
