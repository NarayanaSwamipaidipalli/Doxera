"""Redact PDF: permanently removes selected content with PyMuPDF's redaction (not by drawing boxes on top).

Inputs (job parameters):
- `redactions`: areas the user drew, [{page, x, y, width, height}] in points on the page as displayed
  (top-left origin, after /Rotate and the crop box), which is what the web preview measures.
- `terms`: exact phrases to find on every page (case-insensitive). Older clients send `keywords`.

Policy:
- Whole words: any word an area or a search match touches is removed completely, so no partial identifier
  (e.g. "INV-" left from "INV-SECRET-8274") survives. Search terms match whole words only, never inside a word.
- Text in the areas is deleted from the content (not searchable, copyable or extractable); image pixels under the
  areas are overwritten inside the image data itself (PDF_REDACT_IMAGE_PIXELS); line art fully inside an area is
  removed; annotations and form fields touching an area are deleted.
- The file is rewritten with garbage collection, so replaced image data and removed objects are not kept.
- Every result is re-opened and checked: removed words are gone from the text, the areas render black and the
  image pixels inside them are blanked. The source file is only read. Nothing about the content is logged.
"""
from __future__ import annotations

import re
from typing import Dict, List, Sequence, Tuple

import pymupdf

from .split_tools import UserFacingError, open_source_pdf

MAX_AREAS = 500
MAX_TERMS = 100
MAX_TERM_LENGTH = 200
FILL = (0, 0, 0)


def _areas(raw, page_count: int) -> Dict[int, List[Tuple[float, float, float, float]]]:
    if raw in (None, ""):
        return {}
    if not isinstance(raw, list):
        raise UserFacingError("Redaction areas must be a list.")
    if len(raw) > MAX_AREAS:
        raise UserFacingError(f"Use at most {MAX_AREAS} redaction areas.")
    areas: Dict[int, list] = {}
    for item in raw:
        try:
            page = item["page"]
            x, y, w, h = (float(item[k]) for k in ("x", "y", "width", "height"))
        except (TypeError, KeyError, ValueError):
            raise UserFacingError("Each redaction area needs a page, x, y, width and height.") from None
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= page_count:
            raise UserFacingError(f"A redaction area is on page {page}, but this document has {page_count} pages.")
        if not all(v == v and abs(v) < 1e6 for v in (x, y, w, h)) or w <= 0 or h <= 0:
            raise UserFacingError("A redaction area has an invalid size.")
        areas.setdefault(page - 1, []).append((x, y, x + w, y + h))
    return areas


def _terms(parameters: dict) -> List[str]:
    raw = parameters.get("terms")
    if raw is None:
        legacy = parameters.get("keywords")
        raw = [k for k in re.split(r"[,\n]", legacy)] if isinstance(legacy, str) else legacy or []
    if not isinstance(raw, list) or not all(isinstance(t, str) for t in raw):
        raise UserFacingError("Search terms must be a list of text values.")
    terms = []
    for term in (t.strip() for t in raw):
        if not term:
            continue
        if len(term) > MAX_TERM_LENGTH:
            raise UserFacingError(f"Search terms can be at most {MAX_TERM_LENGTH} characters.")
        if term.lower() not in (t.lower() for t in terms):
            terms.append(term)
    if len(terms) > MAX_TERMS:
        raise UserFacingError(f"Use at most {MAX_TERMS} search terms.")
    return terms


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _term_rects(page: "pymupdf.Page", words: list, term: str) -> List["pymupdf.Rect"]:
    """Whole-word matches of `term` (one or more words), as word rectangles in unrotated page space."""
    wanted = _norm(term).split(" ")
    found = []
    tokens = [_norm(w[4]) for w in words]
    for start in range(len(words) - len(wanted) + 1):
        window = tokens[start:start + len(wanted)]
        # Allow trailing punctuation on the last word ("Testerson," still matches "Testerson").
        if window[:-1] == wanted[:-1] and re.sub(r"[.,;:!?)\]]+$", "", window[-1]) == wanted[-1] or window == wanted:
            found.extend(pymupdf.Rect(w[:4]) for w in words[start:start + len(wanted)])
    return found


def redact_document(input_path: str, output_path: str, parameters: dict) -> dict:
    doc = open_source_pdf(input_path, action="redact it")
    try:
        areas = _areas((parameters or {}).get("redactions"), doc.page_count)
        terms = _terms(parameters or {})
        if not areas and not terms:
            raise UserFacingError("Select at least one area to redact, or add a search term.")
        plan: Dict[int, dict] = {}
        for index, page in enumerate(doc):
            words = page.get_text("words")  # unrotated page coordinates
            rects: List[pymupdf.Rect] = []
            for x0, y0, x1, y1 in areas.get(index, []):
                # Displayed (rotated, crop-box) coordinates -> the page's own coordinates.
                rect = (pymupdf.Rect(x0, y0, x1, y1) * page.derotation_matrix).normalize()
                rects.append(rect)
            for term in terms:
                rects.extend(_term_rects(page, words, term))
            if not rects:
                continue
            # Whole words: widen to every word any area touches, so no partial identifier is left behind.
            removed = []
            for w in words:
                wr = pymupdf.Rect(w[:4])
                if any(wr.intersects(r) for r in rects):
                    removed.append(w[4])
                    rects.append(wr + (-0.5, -0.5, 0.5, 0.5))
            for annot in list(page.annots() or []):
                if annot.type[0] != pymupdf.PDF_ANNOT_REDACT and any(annot.rect.intersects(r) for r in rects):
                    page.delete_annot(annot)
            for widget in list(page.widgets() or []):
                if any(widget.rect.intersects(r) for r in rects):
                    page.delete_widget(widget)
            for rect in rects:
                page.add_redact_annot(rect, fill=FILL)
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                                  graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                                  text=pymupdf.PDF_REDACT_TEXT_REMOVE)
            plan[index] = {"rects": rects, "removed": removed}
        if not plan:
            raise UserFacingError("None of the search terms were found, and no areas were selected.")
        page_count = doc.page_count
        # garbage=4 drops unused objects (the original image data) and merges duplicates; clean rewrites contents.
        doc.save(output_path, garbage=4, deflate=True, clean=True)
    finally:
        doc.close()
    _verify(output_path, plan, page_count)
    return {"pages": len(plan), "areas": sum(len(p["rects"]) for p in plan.values())}


def _verify(output_path: str, plan: dict, page_count: int) -> None:
    check = pymupdf.open(output_path)
    try:
        problems = check.page_count != page_count
        for index, item in plan.items():
            page = check[index]
            # No text may remain inside any redacted area (the same words may legitimately appear elsewhere).
            # No character may remain inside an area. Character boxes use the same (unrotated) coordinates as the
            # redaction; centres are used because neighbouring words' boxes can touch an area's edge.
            centres = [pymupdf.Rect(ch["bbox"]).tl + (pymupdf.Rect(ch["bbox"]).br - pymupdf.Rect(ch["bbox"]).tl) * 0.5
                       for block in page.get_text("rawdict")["blocks"] for line in block.get("lines", [])
                       for span in line["spans"] for ch in span["chars"] if ch["c"].strip()]
            for rect in item["rects"]:
                if any(rect.contains(point) for point in centres):
                    problems = True
            pix = page.get_pixmap(dpi=72)
            for rect in item["rects"]:
                shown = (rect * page.rotation_matrix).normalize() & page.rect
                if shown.is_empty or shown.width < 3 or shown.height < 3:
                    continue
                inner = shown + (1, 1, -1, -1)
                for fx in (0.25, 0.5, 0.75):
                    for fy in (0.3, 0.5, 0.7):
                        px = int(inner.x0 + (inner.width) * fx)
                        py = int(inner.y0 + (inner.height) * fy)
                        if 0 <= px < pix.width and 0 <= py < pix.height and max(pix.pixel(px, py)[:3]) > 40:
                            problems = True
        if problems:
            raise UserFacingError("Redaction failed: the result did not pass its checks. Nothing was produced; please try again.")
    finally:
        check.close()
