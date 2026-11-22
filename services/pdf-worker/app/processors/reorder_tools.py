"""
Reorder PDF Pages with strict, server-side validation.

Request contract (``parameters`` of a ``reorder-pages`` job):

* ``{"pageOrder": [3, 1, 5, 2, 4]}`` -> the output contains original page 3 first, then 1, 5, 2, 4

``pageOrder`` lists 1-based original page numbers and must be a complete permutation of the
uploaded document's pages: every page exactly once, nothing missing, nothing out of range, no
duplicates. Anything else is rejected with a message for the user; pages are never dropped,
duplicated or rotated. Only the downloaded working copy is changed; the original upload in storage
is never modified.

Jobs without ``pageOrder`` keep the original lenient ``newOrder`` behaviour (see ``basic_tools.reorder_pages``).
"""
from typing import Any, List

from .split_tools import PageSelectionError, open_source_pdf

MAX_ORDER_LENGTH = 100_000


def _missing_message(missing: List[int]) -> str:
    shown = ", ".join(str(p) for p in missing[:10]) + (f" and {len(missing) - 10} more" if len(missing) > 10 else "")
    noun = "Page" if len(missing) == 1 else "Pages"
    verb = "is" if len(missing) == 1 else "are"
    return f"{noun} {shown} {verb} missing. Every page must appear exactly once."


def validate_page_order(raw: Any, page_count: int) -> List[int]:
    """Return 0-based indices for a 1-based permutation of ``1..page_count``, or raise PageSelectionError."""
    if not isinstance(raw, list) or not raw:
        raise PageSelectionError("Enter the new page order.")
    if len(raw) > MAX_ORDER_LENGTH:
        raise PageSelectionError("The page order is too long.")
    seen = set()
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, int):
            raise PageSelectionError("Page numbers must be whole numbers.")
        if item < 1:
            raise PageSelectionError(f"Page numbers start at 1 (found {item}).")
        if item > page_count:
            raise PageSelectionError(
                f"Page {item} is beyond the end of this document ({page_count} page{'s' if page_count != 1 else ''})."
            )
        if item in seen:
            raise PageSelectionError(f"Page {item} appears more than once.")
        seen.add(item)
    if len(seen) != page_count:
        raise PageSelectionError(_missing_message([p for p in range(1, page_count + 1) if p not in seen]))
    return [page - 1 for page in raw]


def reorder_pages_strict(input_path: str, output_path: str, page_order: Any) -> List[int]:
    """Write a copy of ``input_path`` with its pages in ``page_order``. Returns the 0-based order used."""
    doc = open_source_pdf(input_path, action="reorder it")
    try:
        order = validate_page_order(page_order, len(doc))
        # select() rearranges the page tree in place, keeping each page object (content, rotation,
        # annotations) intact; links and outline entries that point at kept pages are preserved.
        doc.select(order)
        doc.save(output_path, garbage=3, deflate=True)
        return order
    finally:
        doc.close()
