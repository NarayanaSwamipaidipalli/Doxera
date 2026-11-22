"""
Extract PDF Pages with strict, server-side page validation.

Request contract (``parameters`` of an ``extract-pages`` job, 1-based page numbers):

* ``{"extractMode": "single", "pages": "2, 5, 8-10"}``   -> one PDF with those pages in document order
* ``{"extractMode": "separate", "pages": "2, 5"}``       -> one PDF per selected page (ZIP when more than one)
* ``{"extractMode": "groups", "groups": ["1-5", "8-12"]}`` -> one PDF per group (ZIP when more than one)

Every selection is re-validated against the real page count of the uploaded document; invalid,
out-of-range, duplicate or reversed entries are rejected with a message for the user, never skipped.
Only the downloaded working copy is read; the original upload in storage is never modified.

Jobs without ``extractMode`` keep the original lenient behaviour (see ``basic_tools.extract_pages``).
"""
from typing import Any, List, Tuple

from .split_tools import (
    MAX_RANGE_GROUPS,
    PageSelectionError,
    open_source_pdf,
    parse_page_spec,
    safe_base_name,
    write_outputs,
)

EXTRACT_MODES = ("single", "separate", "groups")


def plan_extract(mode: Any, parameters: dict, page_count: int, base_name: str) -> List[Tuple[str, List[int]]]:
    """Validate the request and return [(output file name, 0-based page indices), ...]."""
    if mode not in EXTRACT_MODES:
        raise PageSelectionError("Unsupported extraction mode.")
    if mode == "single":
        return [(f"{base_name}-extracted-pages.pdf", parse_page_spec(parameters.get("pages"), page_count))]
    if mode == "separate":
        width = max(3, len(str(page_count)))
        return [(f"{base_name}-page-{i + 1:0{width}d}.pdf", [i]) for i in parse_page_spec(parameters.get("pages"), page_count)]
    groups = parameters.get("groups")
    if not isinstance(groups, list) or not groups:
        raise PageSelectionError("Add at least one page group.")
    if len(groups) > MAX_RANGE_GROUPS:
        raise PageSelectionError(f"Use at most {MAX_RANGE_GROUPS} groups.")
    plan = []
    for number, group in enumerate(groups, start=1):
        try:
            indices = parse_page_spec(group, page_count)
        except PageSelectionError as exc:
            raise PageSelectionError(f"Group {number}: {exc}") from None
        plan.append((f"{base_name}-group-{number:02d}-pages-{{label}}.pdf", indices))
    return plan


def extract_pages_by_mode(input_path: str, output_pdf_path: str, mode: Any, parameters: dict, original_name: str) -> str:
    """Run a validated extraction. Returns the output path: a PDF for one output file, otherwise a ZIP."""
    base = safe_base_name(original_name)
    doc = open_source_pdf(input_path, action="extract pages")
    try:
        return write_outputs(doc, plan_extract(mode, parameters or {}, len(doc), base), output_pdf_path)
    finally:
        doc.close()
