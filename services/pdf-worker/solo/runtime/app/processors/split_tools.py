"""
Split PDF processing with strict, server-side page validation.

Request contract (``parameters`` of a ``split`` job):

* ``{"splitMode": "extract", "pages": "1-3, 5"}``  -> one PDF with those pages in document order
* ``{"splitMode": "every"}``                         -> one PDF per page (ZIP when more than one page)
* ``{"splitMode": "ranges", "ranges": ["1-5", "6-10"]}`` -> one PDF per group (ZIP when more than one group)

Page numbers are 1-based. ``pages`` and each range group may be a string ("1-3, 5"), an integer,
or a list of integers/strings. Nothing from the client is trusted: every selection is re-validated
here against the real page count of the uploaded document.

Jobs without ``splitMode`` keep the original lenient behaviour (see ``basic_tools.split_pdf``).
"""
import os
import re
import zipfile
from typing import Any, Iterable, List, Tuple

import pymupdf

MAX_PAGE_SPEC_LENGTH = 4000
MAX_RANGE_GROUPS = 100
SPLIT_MODES = ("extract", "every", "ranges")

_RANGE = re.compile(r"^(\d+)\s*-\s*(\d+)$")
_NUMBER = re.compile(r"^\d+$")


class UserFacingError(ValueError):
    """A processing failure caused by the input. Its message is written for, and safe to show to, the user."""


class PageSelectionError(UserFacingError):
    """The requested pages are invalid for this document."""


def _tokens(raw: Any) -> List[str]:
    if isinstance(raw, bool) or raw is None:
        raise PageSelectionError("Select at least one page.")
    if isinstance(raw, int):
        return [str(raw)]
    if isinstance(raw, str):
        if len(raw) > MAX_PAGE_SPEC_LENGTH:
            raise PageSelectionError("The page selection is too long.")
        return raw.split(",")
    if isinstance(raw, (list, tuple)):
        if len(raw) > MAX_PAGE_SPEC_LENGTH:
            raise PageSelectionError("The page selection is too long.")
        out: List[str] = []
        for item in raw:
            if isinstance(item, bool) or not isinstance(item, (int, str)):
                raise PageSelectionError("Page numbers must be whole numbers like 1-3, 5.")
            out.extend(str(item).split(","))
        return out
    raise PageSelectionError("Page numbers must be whole numbers like 1-3, 5.")


def parse_page_spec(raw: Any, page_count: int) -> List[int]:
    """Parse a 1-based page selection into sorted, unique 0-based indices, rejecting anything invalid."""
    selected: set = set()
    for token in _tokens(raw):
        token = token.strip()
        if not token:
            continue
        if token.startswith("-") or re.match(r"^\d+\s*-\s*-", token):
            raise PageSelectionError(f'Page numbers must be positive (found "{token}").')
        match = _RANGE.match(token)
        if match:
            start, end = int(match.group(1)), int(match.group(2))
        elif _NUMBER.match(token):
            start = end = int(token)
        else:
            raise PageSelectionError(f'Could not understand "{token[:40]}". Use page numbers like 1-3, 5.')
        if start == 0 or end == 0:
            raise PageSelectionError("Page numbers start at 1 (found 0).")
        if start > end:
            raise PageSelectionError(f'The range "{start}-{end}" runs backwards. Write it as {end}-{start}.')
        if end > page_count:
            raise PageSelectionError(
                f"Page {end} is beyond the end of this document ({page_count} page{'s' if page_count != 1 else ''})."
            )
        for page in range(start, end + 1):
            if page in selected:
                raise PageSelectionError(f"Page {page} is selected more than once.")
            selected.add(page)
    if not selected:
        raise PageSelectionError("Select at least one page.")
    return [page - 1 for page in sorted(selected)]


def format_page_spec(indices: Iterable[int]) -> str:
    """0-based indices -> compact 1-based label, e.g. [0, 1, 2, 4] -> '1-3_5'."""
    return "_".join(f"{a + 1}" if a == b else f"{a + 1}-{b + 1}" for a, b in _runs(indices))


def _runs(indices: Iterable[int]) -> List[Tuple[int, int]]:
    runs: List[Tuple[int, int]] = []
    for index in sorted(set(indices)):
        if runs and index == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], index)
        else:
            runs.append((index, index))
    return runs


def safe_base_name(name: str) -> str:
    stem = os.path.splitext(os.path.basename(str(name or "").replace("\\", "/")))[0]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-")[:60]
    return cleaned or "document"


def open_source_pdf(input_path: str, action: str = "split it") -> "pymupdf.Document":
    try:
        doc = pymupdf.open(input_path)
    except Exception:
        raise UserFacingError("This file could not be read as a PDF. It may be damaged.") from None
    if not doc.is_pdf:
        doc.close()
        raise UserFacingError("This file is not a PDF document.")
    if doc.needs_pass:
        doc.close()
        raise UserFacingError(f"This PDF is password-protected. Remove the password with Unlock PDF, then {action}.")
    if len(doc) == 0:
        doc.close()
        raise UserFacingError("This PDF has no pages.")
    return doc


def _pages_to_bytes(doc: "pymupdf.Document", indices: List[int]) -> bytes:
    out = pymupdf.open()
    try:
        for start, end in _runs(indices):
            out.insert_pdf(doc, from_page=start, to_page=end)
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()


def plan_split(mode: Any, parameters: dict, page_count: int, base_name: str) -> List[Tuple[str, List[int]]]:
    """Validate the request and return [(output file name, 0-based page indices), ...]."""
    if mode not in SPLIT_MODES:
        raise PageSelectionError("Unsupported split mode.")
    if mode == "extract":
        return [(f"{base_name}_pages-{{label}}.pdf", parse_page_spec(parameters.get("pages"), page_count))]
    if mode == "every":
        width = max(2, len(str(page_count)))
        return [(f"{base_name}_page-{i + 1:0{width}d}.pdf", [i]) for i in range(page_count)]
    groups = parameters.get("ranges")
    if not isinstance(groups, list) or not groups:
        raise PageSelectionError("Add at least one page range.")
    if len(groups) > MAX_RANGE_GROUPS:
        raise PageSelectionError(f"Use at most {MAX_RANGE_GROUPS} ranges.")
    plan = []
    for number, group in enumerate(groups, start=1):
        try:
            indices = parse_page_spec(group, page_count)
        except PageSelectionError as exc:
            raise PageSelectionError(f"Range {number}: {exc}") from None
        plan.append((f"{base_name}_part-{number:02d}_pages-{{label}}.pdf", indices))
    return plan


def write_outputs(doc: "pymupdf.Document", plan: List[Tuple[str, List[int]]], output_pdf_path: str) -> str:
    """Write one PDF (a single planned output) or a ZIP of named PDFs. Returns the written path.

    Output names may contain ``{label}``, replaced by the compact page label (e.g. ``1-3_5``).
    """
    if len(plan) == 1:
        with open(output_pdf_path, "wb") as handle:
            handle.write(_pages_to_bytes(doc, plan[0][1]))
        return output_pdf_path
    zip_path = os.path.splitext(output_pdf_path)[0] + ".zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, indices in plan:
            archive.writestr(name.format(label=format_page_spec(indices)), _pages_to_bytes(doc, indices))
    return zip_path


def split_pdf_by_mode(input_path: str, output_pdf_path: str, mode: Any, parameters: dict, original_name: str) -> str:
    """Run a validated split. Returns the output path: a PDF for one output file, otherwise a ZIP."""
    base = safe_base_name(original_name)
    doc = open_source_pdf(input_path)
    try:
        return write_outputs(doc, plan_split(mode, parameters or {}, len(doc), base), output_pdf_path)
    finally:
        doc.close()
