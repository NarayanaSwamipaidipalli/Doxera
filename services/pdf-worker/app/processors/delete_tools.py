"""
Delete PDF Pages with strict, server-side page validation.

Request contract (``parameters`` of a ``delete-pages`` job):

* ``{"strictPages": true, "pagesToDelete": "2, 5, 8-12"}``

Page numbers are 1-based and are validated against the real page count of the uploaded document:
out-of-range, zero, negative, backwards, duplicate or unparseable entries are rejected with a
message for the user instead of being skipped, and a request that would remove every page is
refused. The remaining pages keep their original order. Only the downloaded working copy is read;
the original upload in storage is never modified or deleted.

Jobs without ``strictPages`` keep the original lenient behaviour (see ``basic_tools.delete_pages``).
"""
from typing import Any, List

from .delete_navigation import delete_pages_with_bookmarks
from .split_tools import PageSelectionError, open_source_pdf, parse_page_spec


def delete_pages_strict(input_path: str, output_path: str, pages_to_delete: Any) -> List[int]:
    """Write a copy of ``input_path`` without the given pages. Returns the deleted 0-based indices."""
    doc = open_source_pdf(input_path, action="delete pages")
    try:
        page_count = len(doc)
        indices = parse_page_spec(pages_to_delete, page_count)
        if len(indices) >= page_count:
            raise PageSelectionError("You can't delete every page. A PDF must keep at least one page.")
        delete_pages_with_bookmarks(doc, indices)
        doc.save(output_path, garbage=3, deflate=True)
        return indices
    finally:
        doc.close()

