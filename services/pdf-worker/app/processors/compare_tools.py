"""PDF revision comparison. Coordinates are displayed-page points, top-left origin.

Text is NFC-normalized, case/punctuation/numbers and repeated spaces are retained; line
breaks and single inter-word spaces are ignored to allow wrapping. Page correspondence
uses ordered exact anchors, then moved exact pages, then similar unmatched pages.
Visual comparison renders at 96 dpi (at most 4M pixels), aligns translations <=2 px,
ignores channel deltas <=24 and components <9 pixels, and merges regions within 3 px.
Text edit boxes are masked to avoid counting the same edit again as a visual change.
Scans are compared as pixels: no OCR/semantic claim. Inputs are never written.
"""
from __future__ import annotations

from collections import Counter, defaultdict, deque
from difflib import SequenceMatcher
import hashlib
import json
import math
import os
import re
import time
import unicodedata

import cv2
import numpy as np
import pymupdf

from .split_tools import UserFacingError, open_source_pdf

MAX_PAGES = 500
MAX_TOKENS = 100_000
MAX_DIFFERENCES = 10_000
COLORS = {"added": (0.06, 0.55, 0.22), "removed": (0.85, 0.12, 0.18),
          "modified": (0.85, 0.53, 0.02), "visual": (0.85, 0.53, 0.02),
          "page_added": (0.06, 0.55, 0.22), "page_removed": (0.85, 0.12, 0.18),
          "page_moved": (0.25, 0.35, 0.8)}
WARNINGS = [
    "Scanned/image-only content is compared visually, without OCR or semantic interpretation.",
    "Visual tolerance: 96 dpi (maximum 4 million pixels/page), channel delta >24, component >=9 pixels; translations up to 2 pixels aligned.",
    "Line wrapping and single inter-word spaces are ignored; case, punctuation, numbers and repeated spaces are retained.",
    "Page mapping is heuristic for unrelated or repetitive pages. Font and layout differences are visual changes. Reflow can also produce visual changes.",
]


def _matcher(a, b, check):
    """Keep difflib's exact matching, with cancellation/deadline checks inside hot loops."""
    matcher = SequenceMatcher(None, a, b, autojunk=False)

    class Positions:
        def __init__(self, values):
            self.values = values

        def __iter__(self):
            for i, value in enumerate(self.values):
                if i % 2048 == 0:
                    check()
                yield value

    class Index(dict):
        def get(self, key, default=None):
            check()
            return super().get(key, default)

    matcher.b2j = Index({key: Positions(values) for key, values in matcher.b2j.items()})
    return matcher


def _render(page, scale=4 / 3):
    scale = min(scale, math.sqrt(4_000_000 / max(1, page.rect.width * page.rect.height)))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False, annots=True)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy(), scale


def _tokens(page):
    result = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            chars = [c for span in line["spans"] for c in span["chars"]]
            text = "".join(c["c"] for c in chars)
            for match in re.finditer(r"\S+|[ \t]{2,}", text):
                rect = pymupdf.Rect(chars[match.start()]["bbox"])
                for char in chars[match.start() + 1:match.end()]:
                    rect |= pymupdf.Rect(char["bbox"])
                rect = rect * page.rotation_matrix
                result.append({"text": unicodedata.normalize("NFC", match.group()), "page": page.number + 1,
                               "box": [round(v, 3) for v in rect]})
    return result


def _index(doc, check):
    pages, total = [], 0
    if len(doc) > MAX_PAGES:
        raise UserFacingError(f"Compare PDF supports at most {MAX_PAGES} pages per document. Split the document first.")
    for page in doc:
        check()
        tokens = _tokens(page)
        total += len(tokens)
        if total > MAX_TOKENS:
            raise UserFacingError("This document has too much text for one comparison. Split it into smaller documents.")
        # Small signatures only; full-size images are created one pair at a time.
        thumb, _ = _render(page, 96 / max(page.rect.width, page.rect.height))
        thumb = cv2.resize(cv2.cvtColor(thumb, cv2.COLOR_RGB2GRAY), (32, 32))
        text = [t["text"] for t in tokens]
        # Include appearance even when text exists: repeated headers on different
        # graphical pages must not anchor an inserted page to the wrong revision.
        signature = hashlib.sha256(("\0".join(text)).encode() + thumb.tobytes()).hexdigest()
        pages.append({"tokens": tokens, "signature": signature, "thumb": thumb,
                      "size": [round(page.rect.width, 3), round(page.rect.height, 3)]})
    return pages


def _mapping(a, b, check):
    mapping, moved = {}, set()
    matcher = _matcher([p["signature"] for p in a], [p["signature"] for p in b], check)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            mapping[block.a + k] = block.b + k
    available = defaultdict(deque)
    for j, page in enumerate(b):
        if j not in mapping.values():
            available[page["signature"]].append(j)
    for i, page in enumerate(a):
        if i not in mapping and available[page["signature"]]:
            mapping[i] = available[page["signature"]].popleft()
            moved.add(i)
    # Only unmatched pages need similarity matching. Limit candidates to a local window
    # for large unmatched runs; exact moved pages above are found anywhere in the document.
    unmatched_a = [i for i in range(len(a)) if i not in mapping]
    unmatched_b = [j for j in range(len(b)) if j not in mapping.values()]
    bags_a = {i: Counter(t["text"] for t in a[i]["tokens"]) for i in unmatched_a}
    bags_b = {j: Counter(t["text"] for t in b[j]["tokens"]) for j in unmatched_b}
    scores = []
    for ai, i in enumerate(unmatched_a):
        check()
        candidates = unmatched_b if len(unmatched_b) <= 40 else unmatched_b[max(0, ai - 10):ai + 11]
        for j in candidates:
            ca, cb = bags_a[i], bags_b[j]
            if ca or cb:
                score = 2 * sum((ca & cb).values()) / max(1, sum(ca.values()) + sum(cb.values()))
            else:
                score = 1 - float(np.mean(np.abs(a[i]["thumb"].astype(float) - b[j]["thumb"]))) / 255
            if score >= 0.25:
                scores.append((score, -abs(i - j), i, j))
    used = set(mapping.values())
    for _, _, i, j in sorted(scores, reverse=True):
        if i not in mapping and j not in used:
            mapping[i], used = j, used | {j}
    remaining_a = [i for i in unmatched_a if i not in mapping]
    remaining_b = [j for j in unmatched_b if j not in used]
    # A completely replaced page can have no common words.
    if len(remaining_a) == len(remaining_b):
        mapping.update(zip(remaining_a, remaining_b))
    return mapping, moved


def _regions(tokens):
    """Merge adjacent token boxes only on the same line, never to a whole-page box."""
    regions = []
    for token in tokens:
        x0, y0, x1, y1 = token["box"]
        if regions:
            r = regions[-1]
            if r["page"] == token["page"] and abs(r["box"][1] - y0) < 2 and 0 <= x0 - r["box"][2] < 16:
                r["box"][2] = x1
                r["box"][3] = max(r["box"][3], y1)
                continue
        regions.append({"page": token["page"], "box": [x0, y0, x1, y1]})
    return regions


def _visual(a, b, masks_a, masks_b, check):
    check()
    image_a, scale_a = _render(a)
    image_b, scale_b = _render(b)
    # Keep the same physical scale, padding differing dimensions with white.
    scale = min(scale_a, scale_b)
    if scale_a != scale:
        image_a, _ = _render(a, scale)
    if scale_b != scale:
        image_b, _ = _render(b, scale)
    h, w = max(image_a.shape[0], image_b.shape[0]), max(image_a.shape[1], image_b.shape[1])
    if h * w > 8_000_000:
        raise UserFacingError("The page dimensions are too different to compare safely. Compare smaller page groups.")
    first, second = np.full((h, w, 3), 255, np.uint8), np.full((h, w, 3), 255, np.uint8)
    first[:image_a.shape[0], :image_a.shape[1]] = image_a
    second[:image_b.shape[0], :image_b.shape[1]] = image_b
    dx = dy = 0.0
    # Practical alignment is restricted to tiny scan/raster translations.
    if first.shape == second.shape:
        shift, response = cv2.phaseCorrelate(cv2.cvtColor(first, cv2.COLOR_RGB2GRAY).astype(np.float32),
                                            cv2.cvtColor(second, cv2.COLOR_RGB2GRAY).astype(np.float32))
        if response > 0.5 and all(math.isfinite(v) and abs(v) <= 2 for v in shift):
            dx, dy = (float(round(v)) for v in shift)
    aligned = cv2.warpAffine(second, np.float32([[1, 0, -dx], [0, 1, -dy]]), (w, h), borderValue=(255, 255, 255))
    # Correlation on sparse pages can propose a spurious shift. Accept alignment only
    # when it actually reduces the number of differing pixels.
    unaligned_count = np.count_nonzero(np.max(cv2.absdiff(first, second), axis=2) > 24)
    if np.count_nonzero(np.max(cv2.absdiff(first, aligned), axis=2) > 24) >= unaligned_count:
        aligned, dx, dy = second, 0.0, 0.0
    mask = (np.max(cv2.absdiff(first, aligned), axis=2) > 24).astype(np.uint8)
    for regions, offset in ((masks_a, (0, 0)), (masks_b, (-dx, -dy))):
        for region in regions:
            x0, y0, x1, y1 = region["box"]
            cv2.rectangle(mask, (int(x0 * scale + offset[0]) - 2, int(y0 * scale + offset[1]) - 2),
                          (int(x1 * scale + offset[0]) + 2, int(y1 * scale + offset[1]) + 2), 0, -1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    clean = np.zeros_like(mask)
    for k in range(1, count):
        if stats[k, cv2.CC_STAT_AREA] >= 9:
            clean[labels == k] = 1
    clean = cv2.dilate(clean, np.ones((7, 7), np.uint8))
    contours, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    result = []
    for contour in sorted(contours, key=lambda c: (cv2.boundingRect(c)[1], cv2.boundingRect(c)[0])):
        x, y, width, height = cv2.boundingRect(contour)
        original = pymupdf.Rect(x / scale, y / scale, (x + width) / scale, (y + height) / scale) & a.rect
        modified = pymupdf.Rect((x + dx) / scale, (y + dy) / scale, (x + width + dx) / scale, (y + height + dy) / scale) & b.rect
        result.append(([round(v, 3) for v in original] if not original.is_empty else None,
                       [round(v, 3) for v in modified] if not modified.is_empty else None))
    return result


def _report(doc_a, doc_b, result, output, check):
    report = pymupdf.open()
    try:
        # Embed the complete UTF-8 comparison, including data omitted from the bounded UI summary.
        report.embfile_add("comparison.json", json.dumps(result, ensure_ascii=False).encode("utf-8"),
                           filename="comparison.json", desc="Complete comparison data; page references are 1-based")
        font_path = next((p for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"] if os.path.isfile(p)), None)
        page, y = None, 0
        font = pymupdf.Font(fontfile=font_path) if font_path else pymupdf.Font("helv")

        def line(text, color=(0.12, 0.15, 0.2), size=10):
            nonlocal page, y
            # Font-aware wrapping, with continuation pages for long exact edits.
            for paragraph in str(text).split("\n"):
                pending = paragraph or " "
                while pending:
                    if page is None or y > 790:
                        page = report.new_page(width=595, height=842)
                        if font_path:
                            page.insert_font(fontname="ComparisonFont", fontfile=font_path)
                        y = 42
                    end = min(len(pending), 110)
                    while end > 1 and font.text_length(pending[:end], fontsize=size) > 507:
                        end -= 1
                    page.insert_text((44, y), pending[:end], fontname="ComparisonFont" if font_path else "helv", fontsize=size, color=color)
                    y += size + 6
                    pending = pending[end:]

        line("Doxera PDF comparison report", size=18)
        line(f"Original: {result['originalName']} ({result['originalPages']} pages)")
        line(f"Modified: {result['modifiedName']} ({result['modifiedPages']} pages)")
        for key in ("totalDifferences", "pagesChanged", "pagesAdded", "pagesRemoved", "textChanges", "visualChanges", "pagesMoved"):
            line(f"{key}: {result[key]}")
        line("Changed page pairs (original -> modified): " + ", ".join(
            f"{m['originalPage'] or '-'} -> {m['modifiedPage'] or '-'}" for m in result["pageMap"] if m["changed"]))
        for warning in result["warnings"]:
            line(warning, size=9)
        line("Green: added | Red: removed | Amber: modified/visual | Blue: moved")
        for change in result["differences"]:
            check()
            line(f"#{change['id']} {change['type']} - original p.{change['originalPage'] or '-'} / modified p.{change['modifiedPage'] or '-'}", COLORS[change["type"]])
            if change.get("before") is not None:
                line("Before: " + change["before"])
            if change.get("after") is not None:
                line("After: " + change["after"])
            if change.get("description"):
                line(change["description"])

        # Paired screenshots have permanent, precisely placed highlights, visible in every PDF reader.
        for mapping in result["pageMap"]:
            if not mapping["changed"]:
                continue
            check()
            sheet = report.new_page(width=1190, height=842)
            for side, doc, left in (("original", doc_a, 25), ("modified", doc_b, 610)):
                n = mapping[side + "Page"]
                sheet.insert_text((left, 28), f"{side.title()} - page {n or 'absent'}", fontsize=14)
                if n is None:
                    continue
                source = doc[n - 1]
                image, _ = _render(source)
                height, width = image.shape[:2]
                factor = min(550 / source.rect.width, 760 / source.rect.height)
                target = pymupdf.Rect(left, 48, left + source.rect.width * factor, 48 + source.rect.height * factor)
                # Store compressed images in the growing report, rather than keeping all
                # full-resolution page buffers in its in-memory PDF object store.
                ok, png = cv2.imencode('.png', cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
                if not ok:
                    raise RuntimeError("Comparison preview encoding failed")
                sheet.insert_image(target, stream=png.tobytes())
                for change in result["differences"]:
                    for region in change[side + "Regions"]:
                        if region["page"] != n:
                            continue
                        x0, y0, x1, y1 = region["box"]
                        box = pymupdf.Rect(left + x0 * factor, 48 + y0 * factor, left + x1 * factor, 48 + y1 * factor)
                        color = COLORS[change["type"]]
                        sheet.draw_rect(box, color=color, fill=color, fill_opacity=0.18, width=1)
                        sheet.insert_text((box.x0, max(43, box.y0 - 2)), f"#{change['id']}", fontsize=7, color=color)
        report.set_metadata({"title": "Doxera PDF comparison", "subject": "Original and modified documents with exact change regions"})
        report.save(output, garbage=3, deflate=True)
    finally:
        report.close()


def compare_pdfs(path_a, path_b, output_diff_path, *, original_name=None, modified_name=None, check_cancel=None, timeout=240):
    started = time.monotonic()
    next_cancel_check = 0.0

    def check():
        nonlocal next_cancel_check
        now = time.monotonic()
        if now - started > timeout:
            raise UserFacingError("Comparison exceeded its processing time limit. Compare smaller document groups.")
        if check_cancel and now >= next_cancel_check:
            next_cancel_check = now + 0.2
            if check_cancel():
                raise UserFacingError("Comparison canceled.")

    with open_source_pdf(path_a, action="compare it") as doc_a, open_source_pdf(path_b, action="compare it") as doc_b:
        a, b = _index(doc_a, check), _index(doc_b, check)
        mapping, moved = _mapping(a, b, check)
        differences = []

        def add(kind, before=None, after=None, original_regions=None, modified_regions=None, original_page=None, modified_page=None, description=None):
            if len(differences) >= MAX_DIFFERENCES:
                raise UserFacingError("Too many differences for one report. Compare smaller document groups.")
            ra, rb = original_regions or [], modified_regions or []
            differences.append({"id": len(differences) + 1, "type": kind, "before": before, "after": after,
                                "originalPage": original_page or (ra[0]["page"] if ra else None),
                                "modifiedPage": modified_page or (rb[0]["page"] if rb else None),
                                "originalRegions": ra, "modifiedRegions": rb, "description": description})

        def full(page, index):
            return [{"page": index + 1, "box": [0, 0, *page["size"]]}]

        for i in range(len(a)):
            if i not in mapping:
                add("page_removed", before=" ".join(t["text"] for t in a[i]["tokens"]), original_regions=full(a[i], i))
        for j in range(len(b)):
            if j not in mapping.values():
                add("page_added", after=" ".join(t["text"] for t in b[j]["tokens"]), modified_regions=full(b[j], j))
        for i in sorted(moved):
            add("page_moved", original_page=i + 1, modified_page=mapping[i] + 1,
                description="This page moved in document order.")

        # Compare a continuous stream in correspondence order: paragraph reflow over a
        # page boundary does not turn unchanged words into deletions and additions.
        ta = [t for i in sorted(mapping) for t in a[i]["tokens"]]
        tb = [t for i in sorted(mapping) for t in b[mapping[i]]["tokens"]]
        matcher = _matcher([t["text"] for t in ta], [t["text"] for t in tb], check)
        for tag, i0, i1, j0, j1 in matcher.get_opcodes():
            check()
            if tag == "equal":
                continue
            # When repeated sentence endings admit equally good matches, prefer an
            # edit starting at a line boundary, keeping a removed paragraph intact.
            stream, start, end = (ta, i0, i1) if tag == 'delete' else (tb, j0, j1)
            if tag in ('delete', 'insert'):
                shifted = 0
                while start > 0 and end < len(stream) and stream[start]['text'] == stream[end]['text']:
                    if stream[start]['page'] != stream[start - 1]['page'] or abs(stream[start]['box'][1] - stream[start - 1]['box'][1]) > 2:
                        break
                    start += 1; end += 1; shifted += 1
                if tag == 'delete':
                    i0, i1, j0, j1 = start, end, j0 + shifted, j1 + shifted
                else:
                    j0, j1, i0, i1 = start, end, i0 + shifted, i1 + shifted
            old, new = ta[i0:i1], tb[j0:j1]
            original_page = old[0]["page"] if old else (ta[min(i0, len(ta) - 1)]["page"] if ta else None)
            modified_page = new[0]["page"] if new else (tb[min(j0, len(tb) - 1)]["page"] if tb else None)
            add({"replace": "modified", "insert": "added", "delete": "removed"}[tag],
                " ".join(t["text"] for t in old) if old else None,
                " ".join(t["text"] for t in new) if new else None,
                _regions(old), _regions(new), original_page, modified_page)

        text_changes = list(differences)
        for i, j in sorted(mapping.items()):
            check()
            masks_a = [r for d in text_changes for r in d["originalRegions"] if r["page"] == i + 1]
            masks_b = [r for d in text_changes for r in d["modifiedRegions"] if r["page"] == j + 1]
            if a[i]["size"] != b[j]["size"]:
                add("visual", original_page=i + 1, modified_page=j + 1,
                    description=f"Page dimensions changed from {a[i]['size']} to {b[j]['size']} points.")
            for old, new in _visual(doc_a[i], doc_b[j], masks_a, masks_b, check):
                add("visual", original_regions=[{"page": i + 1, "box": old}] if old else [],
                    modified_regions=[{"page": j + 1, "box": new}] if new else [], original_page=i + 1, modified_page=j + 1,
                    description="Rendered appearance changed in this region.")

        changed_a = {r["page"] for d in differences for r in d["originalRegions"]} | {d["originalPage"] for d in differences if d["originalPage"]}
        changed_b = {r["page"] for d in differences for r in d["modifiedRegions"]} | {d["modifiedPage"] for d in differences if d["modifiedPage"]}
        page_map = [{"originalPage": i + 1, "modifiedPage": j + 1, "changed": i + 1 in changed_a or j + 1 in changed_b} for i, j in sorted(mapping.items(), key=lambda pair: pair[1])]
        page_map += [{"originalPage": i + 1, "modifiedPage": None, "changed": True} for i in range(len(a)) if i not in mapping]
        page_map += [{"originalPage": None, "modifiedPage": j + 1, "changed": True} for j in range(len(b)) if j not in mapping.values()]
        page_map.sort(key=lambda m: (m["modifiedPage"] if m["modifiedPage"] else m["originalPage"]))
        result = {"version": 1, "originalName": original_name or os.path.basename(path_a), "modifiedName": modified_name or os.path.basename(path_b),
                  "originalPages": len(a), "modifiedPages": len(b), "totalDifferences": len(differences),
                  "pagesChanged": sum(m["changed"] for m in page_map), "pagesAdded": len(b) - len(mapping),
                  "pagesRemoved": len(a) - len(mapping), "pagesMoved": len(moved),
                  "textChanges": sum(d["type"] in ("added", "removed", "modified") for d in differences),
                  "visualChanges": sum(d["type"] == "visual" for d in differences),
                  "pageMap": page_map, "differences": differences, "warnings": list(WARNINGS)}
        _report(doc_a, doc_b, result, output_diff_path, check)
        # Bound the authenticated job callback to fit the API's 100 KB request limit.
        summary = {**result, "differences": [], "detailsTruncated": False}
        size = len(json.dumps(summary).encode("utf-8"))
        for difference in differences:
            size += len(json.dumps(difference).encode("utf-8")) + 2
            if size > 80_000:
                summary["detailsTruncated"] = True
                break
            summary["differences"].append(difference)
        return summary
