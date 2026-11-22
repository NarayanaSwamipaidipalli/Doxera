"""
PDF to PowerPoint (.pptx) conversion.

Modes (``parameters["pptMode"]``):

* ``"visual"`` (default) - one slide per page. Each page is rendered to a high-resolution picture
  that fills the slide at the page's exact proportions, so the slide looks like the PDF (fonts,
  tables, diagrams, images). The slide content is a picture and is NOT editable; the page text is
  copied into the slide notes so it stays searchable and can be copied.
* ``"editable"`` - one slide per page rebuilt from the PDF's objects: horizontal text becomes text
  boxes (font, size, colour, bold/italic, position, one paragraph per line), ruled tables become
  native PowerPoint tables, simple vector rectangles and lines become shapes, and upright images
  become separate pictures, stacked in the PDF's drawing order. Anything that cannot be rebuilt
  faithfully (curves, gradients, polygons, rotated text, clipped artwork, annotations) stays visible
  in a background picture of the page from which the rebuilt elements were removed, so nothing is
  silently dropped. Scanned pages (a full-page image without real text) are kept as pictures, with
  any OCR text in the notes. If rebuilding a page fails, that page falls back to a picture slide.

Slide size: a deck has a single slide size, so we use the most common page size in the document
(kept within PowerPoint's 1-56 inch limits). Pages of other sizes are scaled to fit inside the slide
without cropping or distortion and centred, leaving white margins.

The source PDF is only read; an in-memory working copy is modified for the editable background.
"""
import io
import math
import re
import statistics
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import pymupdf
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

from .split_tools import UserFacingError, open_source_pdf

PPT_MODES = ("visual", "editable")
EMU_PER_PT = 12700
EMU_PER_INCH = 914400
MIN_SLIDE_EMU = EMU_PER_INCH          # PowerPoint limits: 1 in ...
MAX_SLIDE_EMU = 56 * EMU_PER_INCH     # ... to 56 in
MAX_RENDER_PIXELS = 16_000_000        # per rendered page picture (about 4000 x 4000)
PNG_SIZE_LIMIT = 1_500_000            # larger renders (photos, scans) are stored as JPEG instead
SCANNED_COVERAGE = 0.85
MAX_SHAPES_PER_PAGE = 400
MAX_IMAGES_PER_PAGE = 60
MAX_TABLES_PER_PAGE = 10
NOTES_LIMIT = 20_000
TEXT_FLAGS = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES

FONT_MAP = {
    "helvetica": "Arial", "helv": "Arial", "arial": "Arial", "arialnarrow": "Arial Narrow",
    "times": "Times New Roman", "timesroman": "Times New Roman", "timesnewroman": "Times New Roman", "tiro": "Times New Roman",
    "courier": "Courier New", "couriernew": "Courier New", "cour": "Courier New",
    "symbol": "Symbol", "zapfdingbats": "Wingdings",
}
STYLE_WORDS = {"regular", "book", "roman", "normal", "bold", "italic", "oblique", "bolditalic", "boldoblique", "medium", "semibold", "demibold"}


# ---------------------------------------------------------------- geometry

def render_dpi(page_count: int) -> int:
    """Picture resolution per displayed inch: sharp for normal decks, lighter for very long documents."""
    if page_count <= 60:
        return 200
    if page_count <= 200:
        return 150
    return 110


def choose_slide_size(page_sizes: List[Tuple[float, float]]) -> Tuple[int, int]:
    """Slide size (EMU) for the deck: the most common page size (first wins ties), within 1-56 in."""
    counts = Counter((round(w, 1), round(h, 1)) for w, h in page_sizes)
    order = {size: i for i, size in reversed(list(enumerate((round(w, 1), round(h, 1)) for w, h in page_sizes)))}
    width, height = max(counts, key=lambda s: (counts[s], -order[s]))
    w, h = width * EMU_PER_PT, height * EMU_PER_PT
    longest, shortest = max(w, h), min(w, h)
    scale = 1.0
    if longest > MAX_SLIDE_EMU:
        scale = MAX_SLIDE_EMU / longest
    elif shortest < MIN_SLIDE_EMU:
        scale = min(MIN_SLIDE_EMU / shortest, MAX_SLIDE_EMU / longest)
    # Extreme proportions (beyond 56:1) cannot be represented; the clamp then letterboxes the page.
    def clamp(v: float) -> int:
        return max(MIN_SLIDE_EMU, min(MAX_SLIDE_EMU, int(round(v * scale))))
    return clamp(w), clamp(h)


class Placement:
    """Maps page coordinates (points, origin top-left) onto the slide: uniform scale, centred."""

    def __init__(self, page_rect: "pymupdf.Rect", slide_w: int, slide_h: int):
        self.x0, self.y0 = page_rect.x0, page_rect.y0
        self.k = min(slide_w / page_rect.width, slide_h / page_rect.height)  # EMU per point
        self.width = int(round(page_rect.width * self.k))
        self.height = int(round(page_rect.height * self.k))
        self.ox = (slide_w - self.width) / 2
        self.oy = (slide_h - self.height) / 2

    @property
    def font_scale(self) -> float:
        return self.k / EMU_PER_PT

    def x(self, v: float) -> int:
        return int(round(self.ox + (v - self.x0) * self.k))

    def y(self, v: float) -> int:
        return int(round(self.oy + (v - self.y0) * self.k))

    def length(self, v: float) -> int:
        return max(1, int(round(v * self.k)))

    def rect(self, r) -> Tuple[int, int, int, int]:
        r = pymupdf.Rect(r)
        return self.x(r.x0), self.y(r.y0), self.length(r.width), self.length(r.height)


def render_page(page: "pymupdf.Page", placement: Placement, dpi: int) -> bytes:
    """Render a page for its displayed size at `dpi`, capped in pixels; PNG, or JPEG for large renders."""
    displayed_inches = placement.width / EMU_PER_INCH
    zoom = displayed_inches * dpi / page.rect.width
    pixels = (page.rect.width * zoom) * (page.rect.height * zoom)
    if pixels > MAX_RENDER_PIXELS:
        zoom *= math.sqrt(MAX_RENDER_PIXELS / pixels)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, annots=True)
    try:
        data = pix.tobytes("png")
        if len(data) > PNG_SIZE_LIMIT:
            data = pix.tobytes("jpg", jpg_quality=88)
        return data
    finally:
        del pix


# ---------------------------------------------------------------- pptx helpers

def _rgb(colour) -> Optional[RGBColor]:
    if colour is None:
        return None
    if isinstance(colour, int):
        return RGBColor((colour >> 16) & 255, (colour >> 8) & 255, colour & 255)
    if len(colour) == 1:
        colour = (colour[0],) * 3
    if len(colour) == 4:  # CMYK
        c, m, y, k = colour
        colour = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return RGBColor(*(max(0, min(255, int(round(v * 255)))) for v in colour[:3]))


def add_picture(slide, data: bytes, left: int, top: int, width: int, height: int, name: str, description: str):
    picture = slide.shapes.add_picture(io.BytesIO(data), Emu(left), Emu(top), Emu(width), Emu(height))
    picture.name = name
    picture._element.nvPicPr.cNvPr.set("descr", description)
    return picture


def set_notes(slide, text: str) -> None:
    text = text.strip()
    if text:
        slide.notes_slide.notes_text_frame.text = text[:NOTES_LIMIT]


def font_family(raw: str) -> str:
    """PDF font name -> a family name office apps understand ("ABCDEF+DejaVuSans-Bold" -> "DejaVu Sans")."""
    name = raw.split("+", 1)[1] if re.match(r"^[A-Z]{6}\+", raw or "") else (raw or "")
    base = re.split(r"[-,]", name)[0].strip()
    words = base.split()
    while len(words) > 1 and words[-1].lower() in STYLE_WORDS:
        words.pop()
    base = " ".join(words)
    key = re.sub(r"(psmt|mt|ps)$", "", re.sub(r"[^a-z]", "", base.lower()))
    if key in FONT_MAP:
        return FONT_MAP[key]
    if " " not in base and key.startswith("dejavu"):
        base = "DejaVu " + base[6:].replace("Sans", "Sans ").replace("Serif", "Serif ").strip()
    return (base or "Arial")[:64]


def _is_bold(span) -> bool:
    name = (span.get("font") or "").lower()
    return bool(span["flags"] & 16) or any(w in name for w in ("bold", "black", "heavy", "semibold", "demi"))


def _is_italic(span) -> bool:
    name = (span.get("font") or "").lower()
    return bool(span["flags"] & 2) or "italic" in name or "oblique" in name


# ---------------------------------------------------------------- editable planning

@dataclass
class TextLine:
    bbox: Tuple[float, float, float, float]
    baseline: float
    spans: List[Dict[str, Any]]


@dataclass
class TextBox:
    lines: List[TextLine]

    @property
    def bbox(self) -> "pymupdf.Rect":
        r = pymupdf.Rect(self.lines[0].bbox)
        for line in self.lines[1:]:
            r |= line.bbox
        return r


@dataclass
class TablePlan:
    bbox: "pymupdf.Rect"
    columns: List[float]          # widths, points
    rows: List[float]             # heights, points
    cells: List[List[str]]
    font_size: float
    font: str
    pitch: str
    bold_rows: List[bool]
    colour: Any
    border_width: float
    border_colour: Any


@dataclass
class PagePlan:
    background: bool = False
    graphics: List[Tuple[int, str, Any]] = field(default_factory=list)  # (seqno, kind, data)
    tables: List[TablePlan] = field(default_factory=list)
    text: List[TextBox] = field(default_factory=list)


def _visible_spans(line) -> List[Dict[str, Any]]:
    return [s for s in line["spans"] if s["text"].strip() and s.get("alpha", 255) != 0]


def _is_horizontal(line) -> bool:
    dx, dy = line["dir"]
    return abs(dy) < 1e-3 and dx > 0


def _inside(rect, area, tolerance=2.0) -> bool:
    r = pymupdf.Rect(rect)
    return (r.x0 >= area.x0 - tolerance and r.y0 >= area.y0 - tolerance and r.x1 <= area.x1 + tolerance and r.y1 <= area.y1 + tolerance)


def _centre_inside(rect, area) -> bool:
    r = pymupdf.Rect(rect)
    return area.contains(pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))


def is_scanned(page: "pymupdf.Page", blocks) -> bool:
    """A page that is essentially one big image without visible text (a scan, possibly with an OCR layer)."""
    area = abs(page.rect)
    covered = sum(abs(pymupdf.Rect(i["bbox"]) & page.rect) for i in page.get_image_info())
    visible = sum(len(s["text"].strip()) for b in blocks if b["type"] == 0 for line in b["lines"] for s in _visible_spans(line))
    return area > 0 and covered / area >= SCANNED_COVERAGE and visible < 20


def _merge_segments(segments, tolerance=1.5):
    """Join collinear segments (pos, start, end) that touch, e.g. a row line drawn cell by cell."""
    merged = []
    for pos, start, end in sorted(segments):
        last = merged[-1] if merged else None
        if last and abs(last[0] - pos) <= tolerance and start <= last[2] + tolerance:
            merged[-1] = (last[0], last[1], max(last[2], end))
        else:
            merged.append((pos, start, end))
    return merged


def _ruling_lines(drawings):
    """Horizontal and vertical rules from stroked lines, thin filled rectangles and outlined rectangles."""
    horizontal, vertical = [], []
    for d in drawings:
        stroked = d.get("color") is not None
        for item in d["items"]:
            if item[0] == "l" and stroked:
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 1:
                    horizontal.append(((p1.y + p2.y) / 2, min(p1.x, p2.x), max(p1.x, p2.x)))
                elif abs(p1.x - p2.x) < 1:
                    vertical.append(((p1.x + p2.x) / 2, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif item[0] == "re":
                r = pymupdf.Rect(item[1])
                if r.height < 2.5 and r.width > 5:
                    horizontal.append(((r.y0 + r.y1) / 2, r.x0, r.x1))
                elif r.width < 2.5 and r.height > 5:
                    vertical.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
                elif stroked:
                    horizontal += [(r.y0, r.x0, r.x1), (r.y1, r.x0, r.x1)]
                    vertical += [(r.x0, r.y0, r.y1), (r.x1, r.y0, r.y1)]
    return _merge_segments(horizontal), _merge_segments(vertical)


def find_ruled_tables(drawings, tolerance=2.0) -> List[Tuple["pymupdf.Rect", List[float], List[float]]]:
    """Fully ruled grids: >= 3 horizontal rules spanning the same width and >= 3 vertical rules spanning the
    same height, with the outer rules on the edges. Returns (bbox, column x positions, row y positions).
    Grids with partial rules (merged cells) are not returned."""
    horizontal, vertical = _ruling_lines(drawings)
    tables = []
    groups: Dict[Tuple[int, int], List[float]] = {}
    for y, x0, x1 in horizontal:
        key = next((k for k in groups if abs(k[0] - x0) <= tolerance and abs(k[1] - x1) <= tolerance), (x0, x1))
        groups.setdefault(key, []).append(y)
    for (x0, x1), ys in groups.items():
        ys = sorted({round(y, 1) for y in ys})
        if len(ys) < 3 or x1 - x0 < 20:
            continue
        y0, y1 = ys[0], ys[-1]
        xs = sorted({round(x, 1) for x, v0, v1 in vertical
                     if x0 - tolerance <= x <= x1 + tolerance and abs(v0 - y0) <= tolerance and abs(v1 - y1) <= tolerance})
        if len(xs) < 3 or abs(xs[0] - x0) > tolerance or abs(xs[-1] - x1) > tolerance:
            continue
        # Any rule inside the grid that stops short means merged cells: not a plain grid.
        partial = any(x0 + tolerance < x < x1 - tolerance and (v0 > y0 + tolerance or v1 < y1 - tolerance) and v1 > y0 and v0 < y1
                      for x, v0, v1 in vertical) or any(
                      y0 + tolerance < y < y1 - tolerance and (h0 > x0 + tolerance or h1 < x1 - tolerance) and h1 > x0 and h0 < x1
                      for y, h0, h1 in horizontal)
        if not partial:
            tables.append((pymupdf.Rect(x0, y0, x1, y1), xs, ys))
    return tables[:MAX_TABLES_PER_PAGE]


def _cell_text(spans) -> str:
    """Join a cell's spans into lines (by baseline) in reading order."""
    lines: List[List[Dict[str, Any]]] = []
    for span in sorted(spans, key=lambda s: (round(s["origin"][1]), s["origin"][0])):
        if lines and abs(lines[-1][0]["origin"][1] - span["origin"][1]) <= 1.5:
            lines[-1].append(span)
        else:
            lines.append([span])
    out = []
    for line in lines:
        text = ""
        for span in line:
            piece = span["text"]
            if text and not text.endswith(" ") and not piece.startswith(" "):
                text += " "
            text += piece
        out.append(text.strip())
    return "\n".join(out)


def _plan_tables(page: "pymupdf.Page", spans_by_rect, drawings) -> List[TablePlan]:
    plans: List[TablePlan] = []
    for bbox, xs, ys in find_ruled_tables(drawings):
        columns = [b - a for a, b in zip(xs, xs[1:])]
        heights = [b - a for a, b in zip(ys, ys[1:])]
        inside = [s for r, s in spans_by_rect if _centre_inside(r, bbox)]
        content, bold_rows = [], []
        for top, bottom in zip(ys, ys[1:]):
            row_spans = [s for s in inside if top <= (s["bbox"][1] + s["bbox"][3]) / 2 < bottom]
            bold_rows.append(bool(row_spans) and all(_is_bold(s) for s in row_spans))
            content.append([
                _cell_text([s for s in row_spans if left <= (s["bbox"][0] + s["bbox"][2]) / 2 < right])
                for left, right in zip(xs, xs[1:])
            ])
        sizes = [s["size"] for s in inside] or [11.0]
        fonts = Counter(office_font(s)[0] for s in inside)
        colours = Counter(s["color"] for s in inside)
        strokes = [d for d in drawings if _inside(d["rect"], bbox) and d.get("color") is not None]
        plans.append(TablePlan(
            bbox=bbox, columns=columns, rows=heights, cells=content,
            font_size=statistics.median(sizes), font=fonts.most_common(1)[0][0] if fonts else "Arial",
            pitch=Counter(pitch_family(s) for s in inside).most_common(1)[0][0] if inside else "34",
            bold_rows=bold_rows, colour=colours.most_common(1)[0][0] if colours else 0,
            border_width=statistics.median([d.get("width") or 1.0 for d in strokes]) if strokes else 1.0,
            border_colour=Counter(tuple(d["color"]) for d in strokes).most_common(1)[0][0] if strokes else (0, 0, 0),
        ))
    return plans


def _simple_drawing(path) -> bool:
    if (path.get("fill_opacity") not in (None, 1, 1.0)) or (path.get("stroke_opacity") not in (None, 1, 1.0)):
        return False
    dashes = (path.get("dashes") or "").replace(" ", "")
    if dashes not in ("", "[]0", "[]"):
        return False
    kinds = {item[0] for item in path["items"]}
    if not kinds <= {"re", "l"}:
        return False
    if path.get("fill") is not None and "l" in kinds:
        return False  # filled polygon (arrow heads, triangles)
    if path.get("fill") is not None and sum(1 for it in path["items"] if it[0] == "re") > 1 and path.get("even_odd"):
        return False  # frame with a hole
    return True


def _upright(transform) -> bool:
    a, b, c, d, _, _ = transform
    return a > 0 and d > 0 and abs(b) < 1e-6 and abs(c) < 1e-6


def _extract_image(doc: "pymupdf.Document", xref: int) -> bytes:
    pix = pymupdf.Pixmap(doc, xref)
    try:
        info = doc.extract_image(xref)
        if info.get("smask"):
            pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, info["smask"]))
        elif info.get("ext") in ("jpeg", "jpg") and pix.n in (1, 3) and not pix.alpha:
            return info["image"]  # embed the original JPEG unchanged
        if pix.colorspace and pix.colorspace.n not in (1, 3):
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        if pix.width * pix.height > MAX_RENDER_PIXELS:
            factor = math.ceil(math.log2(math.sqrt(pix.width * pix.height / MAX_RENDER_PIXELS)))
            pix.shrink(max(1, factor))
        return pix.tobytes("png")
    finally:
        del pix


def plan_editable_page(source_doc: "pymupdf.Document", page: "pymupdf.Page") -> Tuple[PagePlan, bool]:
    """Work out the editable elements for `page` (a page of a disposable working copy, rotation removed)
    and strip them from it so that only what could not be rebuilt remains for the background picture.
    Returns (plan, scanned)."""
    plan = PagePlan()
    blocks = page.get_text("dict", flags=TEXT_FLAGS)["blocks"]
    if is_scanned(page, blocks):
        return plan, True

    drawings = page.get_drawings()
    log = page.get_bboxlog()

    # Text spans that will become editable (horizontal, visible).
    spans_by_rect = []
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            if _is_horizontal(line):
                for span in _visible_spans(line):
                    spans_by_rect.append((pymupdf.Rect(span["bbox"]), span))

    plan.tables = _plan_tables(page, spans_by_rect, drawings)
    table_areas = [t.bbox for t in plan.tables]

    for block in blocks:
        if block["type"] != 0:
            continue
        lines: List[TextLine] = []
        for line in block["lines"]:
            if not _is_horizontal(line):
                continue
            spans = [s for s in _visible_spans(line) if not any(_centre_inside(s["bbox"], a) for a in table_areas)]
            if spans:
                bounds = pymupdf.Rect(spans[0]["bbox"])
                for span in spans[1:]:
                    bounds |= span["bbox"]
                lines.append(TextLine(bbox=tuple(bounds), baseline=spans[0]["origin"][1], spans=spans))
        if not lines:
            continue
        # Lines must stack top to bottom to share a text box; otherwise each line gets its own box.
        stacked = all(b.bbox[1] >= a.bbox[3] - 0.35 * (a.bbox[3] - a.bbox[1]) for a, b in zip(lines, lines[1:]))
        plan.text.extend([TextBox(lines)] if stacked else [TextBox([line]) for line in lines])

    # Vector shapes: all-or-nothing per page so stacking stays correct.
    table_drawings = {id(d) for d in drawings for a in table_areas if _inside(d["rect"], a)}
    other = [d for d in drawings if id(d) not in table_drawings]
    shapes_ok = len(other) <= MAX_SHAPES_PER_PAGE and all(_simple_drawing(d) for d in other)

    # Images: separate pictures only if every image can be extracted upright, and vector art that stays in
    # the background does not overlap them (it could otherwise end up hidden behind a picture).
    infos = page.get_image_info(xrefs=True)
    images_ok = len(infos) <= MAX_IMAGES_PER_PAGE and all(i["xref"] > 0 and _upright(i["transform"]) for i in infos)
    if images_ok and not shapes_ok and other:
        images_ok = not any(pymupdf.Rect(d["rect"]).intersects(i["bbox"]) for d in other for i in infos)
    extracted: List[Tuple[int, bytes, Any]] = []
    if images_ok and infos:
        image_positions = [i for i, (kind, _) in enumerate(log) if kind == "fill-image"]
        try:
            for n, info in enumerate(infos):
                seq = image_positions[n] if n < len(image_positions) else len(log) + n
                extracted.append((seq, _extract_image(source_doc, info["xref"]), pymupdf.Rect(info["bbox"])))
        except Exception:
            images_ok, extracted = False, []

    if shapes_ok:
        plan.graphics.extend((d["seqno"], "path", d) for d in other)
    if images_ok:
        plan.graphics.extend((seq, "image", (data, bbox)) for seq, data, bbox in extracted)
    plan.graphics.sort(key=lambda g: g[0])

    # Strip rebuilt content from the working page; render what is left as the background.
    for box in plan.text:
        for line in box.lines:
            for span in line.spans:
                r = pymupdf.Rect(span["bbox"])
                page.add_redact_annot(pymupdf.Rect(r.x0 + 0.3, r.y0 + 0.3, r.x1 - 0.3, r.y1 - 0.3), fill=False)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE, text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    if plan.tables:
        for area in table_areas:
            page.add_redact_annot(area + (-1, -1, 1, 1), fill=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    if (shapes_ok and other) or (images_ok and infos):
        page.add_redact_annot(page.rect, fill=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_REMOVE if images_ok else pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED if shapes_ok else pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_NONE,
        )
    remaining = [kind for kind, _ in page.get_bboxlog() if not kind.startswith(("ignore", "clip", "pop", "push"))]
    plan.background = bool(remaining) or any(True for _ in page.annots()) or page.first_widget is not None
    return plan, False


# ---------------------------------------------------------------- editable emission

def _style_line(line_format, colour, width_emu: int) -> None:
    if colour is None:
        line_format.fill.background()
    else:
        line_format.color.rgb = _rgb(colour)
        line_format.width = Emu(width_emu)


def _emit_path(slide, path, at: Placement) -> None:
    fill, stroke = path.get("fill"), path.get("color")
    width = at.length(path.get("width") or 1.0)
    for item in path["items"]:
        if item[0] == "re":
            rect = pymupdf.Rect(item[1])
            if rect.is_empty and fill is not None and stroke is None:
                continue
            shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, *(Emu(v) for v in at.rect(rect)))
            shape.shadow.inherit = False
            if fill is None:
                shape.fill.background()
            else:
                shape.fill.solid()
                shape.fill.fore_color.rgb = _rgb(fill)
            _style_line(shape.line, stroke, width)
        elif item[0] == "l" and stroke is not None:
            p1, p2 = item[1], item[2]
            connector = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Emu(at.x(p1.x)), Emu(at.y(p1.y)), Emu(at.x(p2.x)), Emu(at.y(p2.y)))
            _style_line(connector.line, stroke, width)


def pitch_family(span) -> str:
    """OOXML pitchFamily hint so a viewer that lacks the font substitutes a similar one:
    49 = fixed-pitch (monospace), 18 = roman (serif), 34 = swiss (sans-serif)."""
    name = (span.get("font") or "").lower()
    if span["flags"] & 8 or any(w in name for w in ("mono", "courier", "consol", "code")):
        return "49"
    serif_name = any(w in name for w in ("serif", "times", "georgia", "garamond", "roman", "cambria", "palatino", "antiqua"))
    if (span["flags"] & 4 or serif_name) and "sans" not in name:
        return "18"
    return "34"


# Fonts installed with Windows, macOS and/or Microsoft Office. Other fonts are usually missing on the
# viewer's computer, and PowerPoint then falls back to its theme font (sans-serif), so they are replaced
# by a common font of the same kind to keep editable decks looking the same everywhere.
OFFICE_FONTS = {
    "arial", "arial narrow", "arial black", "aptos", "book antiqua", "bookman old style", "calibri", "calibri light", "cambria",
    "candara", "century", "century gothic", "comic sans ms", "consolas", "constantia", "corbel", "courier new",
    "franklin gothic medium", "garamond", "georgia", "gill sans mt", "impact", "lucida console", "lucida sans unicode",
    "palatino linotype", "segoe ui", "segoe ui light", "segoe ui semibold", "symbol", "tahoma", "times new roman",
    "trebuchet ms", "verdana", "wingdings",
}
SUBSTITUTES = {"18": "Times New Roman", "34": "Arial", "49": "Courier New"}


def office_font(span) -> Tuple[str, str]:
    """(typeface, pitchFamily) for a span: its own family when commonly installed, else a same-kind substitute."""
    family, pitch = font_family(span.get("font") or ""), pitch_family(span)
    return (family if family.lower() in OFFICE_FONTS else SUBSTITUTES[pitch]), pitch


def _set_font_name(font, family: str, pitch: str) -> None:
    font.name = family
    latin = font._rPr.find(qn("a:latin"))
    if latin is not None:
        latin.set("pitchFamily", pitch)
        latin.set("charset", "0")


def _apply_font(font, span, scale: float) -> None:
    font.size = Pt(max(1.0, round(span["size"] * scale, 2)))
    _set_font_name(font, *office_font(span))
    font.bold = _is_bold(span)
    font.italic = _is_italic(span)
    font.color.rgb = _rgb(span["color"])


def _emit_text(slide, box: TextBox, at: Placement) -> None:
    rect = box.bbox
    # A little extra width so substitute fonts that run slightly wider do not clip; wrapping is off.
    shape = slide.shapes.add_textbox(Emu(at.x(rect.x0)), Emu(at.y(rect.y0)), Emu(at.length(rect.width * 1.04 + 2)), Emu(at.length(rect.height)))
    frame = shape.text_frame
    frame.word_wrap = False
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
    frame.vertical_anchor = MSO_ANCHOR.TOP
    spacings = [b.baseline - a.baseline for a, b in zip(box.lines, box.lines[1:])]
    for index, line in enumerate(box.lines):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        indent = line.bbox[0] - rect.x0
        if indent > 0.5:
            paragraph._p.get_or_add_pPr().set("marL", str(at.length(indent)))
        if spacings:
            spacing = spacings[index - 1] if index > 0 else spacings[0]
            if spacing > 0:
                paragraph.line_spacing = Pt(round(spacing * at.font_scale, 2))
        for span in line.spans:
            run = paragraph.add_run()
            run.text = span["text"]
            _apply_font(run.font, span, at.font_scale)
    shape.name = "Text " + box.lines[0].spans[0]["text"].strip()[:30]


def _set_cell_borders(cell, width_emu: int, colour) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
        for old in tc_pr.findall(qn(tag)):
            tc_pr.remove(old)
        line = tc_pr.makeelement(qn(tag), {"w": str(width_emu), "cap": "flat", "cmpd": "sng", "algn": "ctr"})
        fill = line.makeelement(qn("a:solidFill"), {})
        clr = fill.makeelement(qn("a:srgbClr"), {"val": str(_rgb(colour))})
        fill.append(clr)
        line.append(fill)
        line.append(line.makeelement(qn("a:prstDash"), {"val": "solid"}))
        tc_pr.append(line)
    # Schema order: borders must precede the cell fill.
    fill = tc_pr.find(qn("a:noFill"))
    if fill is None:
        fill = tc_pr.makeelement(qn("a:noFill"), {})
    else:
        tc_pr.remove(fill)
    tc_pr.append(fill)


def _emit_table(slide, plan: TablePlan, at: Placement) -> None:
    x, y, w, h = at.rect(plan.bbox)
    frame = slide.shapes.add_table(len(plan.rows), len(plan.columns), Emu(x), Emu(y), Emu(w), Emu(h))
    table = frame.table
    tbl_pr = frame._element.graphic.graphicData.tbl.tblPr
    for attr in ("firstRow", "bandRow", "firstCol", "lastRow", "lastCol", "bandCol"):
        tbl_pr.set(attr, "0")
    style = tbl_pr.find(qn("a:tableStyleId"))
    if style is not None:
        tbl_pr.remove(style)
    for c, width in enumerate(plan.columns):
        table.columns[c].width = Emu(at.length(width))
    for r, height in enumerate(plan.rows):
        table.rows[r].height = Emu(at.length(height))
    size = Pt(max(1.0, round(plan.font_size * at.font_scale, 2)))
    margin = Emu(at.length(3))
    for r, row in enumerate(plan.cells):
        for c, value in enumerate(row[: len(plan.columns)]):
            cell = table.cell(r, c)
            cell.margin_left = cell.margin_right = margin
            cell.margin_top = cell.margin_bottom = Emu(at.length(1))
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            frame_ = cell.text_frame
            frame_.word_wrap = True
            frame_.text = value
            for paragraph in frame_.paragraphs:
                for run in paragraph.runs:
                    run.font.size = size
                    _set_font_name(run.font, plan.font, plan.pitch)
                    run.font.bold = plan.bold_rows[r]
                    run.font.color.rgb = _rgb(plan.colour)
            _set_cell_borders(cell, at.length(plan.border_width), plan.border_colour)
    frame.name = "Table"


# ---------------------------------------------------------------- deck assembly

def _visual_slide(prs, layout, page, at: Placement, dpi: int, number: int, note: str = "") -> None:
    slide = prs.slides.add_slide(layout)
    add_picture(slide, render_page(page, at, dpi), at.x(page.rect.x0), at.y(page.rect.y0), at.width, at.height,
                f"Page {number}", f"Page {number} of the original PDF")
    text = page.get_text("text", sort=True)
    set_notes(slide, f"{note}\n\n{text}" if note else text)


def _editable_slide(prs, layout, source_doc, work_page, at: Placement, dpi: int, number: int, plan: PagePlan) -> None:
    slide = prs.slides.add_slide(layout)
    if plan.background:
        add_picture(slide, render_page(work_page, at, dpi), at.x(work_page.rect.x0), at.y(work_page.rect.y0), at.width, at.height,
                    f"Page {number} background", f"Graphics from page {number} that could not be converted to editable shapes")
    for _, kind, data in plan.graphics:
        if kind == "path":
            _emit_path(slide, data, at)
        else:
            image, bbox = data
            add_picture(slide, image, *at.rect(bbox), f"Image on page {number}", f"Image from page {number}")
    for table in plan.tables:
        _emit_table(slide, table, at)
    for box in plan.text:
        _emit_text(slide, box, at)


def convert_pdf_to_pptx(input_path: str, output_path: str, mode: Any = "visual", title: str = "") -> Dict[str, Any]:
    """Convert a PDF to .pptx. Returns a summary: {"slides", "mode", "picture_pages": [...]}."""
    if mode not in PPT_MODES:
        raise UserFacingError("Choose a conversion mode: visual or editable.")
    doc = open_source_pdf(input_path, action="convert it")
    work = pymupdf.open(input_path) if mode == "editable" else None
    try:
        page_count = len(doc)
        slide_w, slide_h = choose_slide_size([(p.rect.width, p.rect.height) for p in doc])
        dpi = render_dpi(page_count)
        prs = Presentation()
        prs.slide_width, prs.slide_height = Emu(slide_w), Emu(slide_h)
        layout = prs.slide_layouts[6]  # blank
        picture_pages: List[int] = []
        for index in range(page_count):
            number = index + 1
            page = doc[index]
            if mode == "visual":
                _visual_slide(prs, layout, page, Placement(page.rect, slide_w, slide_h), dpi, number)
                continue
            work_page = work[index]
            if work_page.rotation:
                work_page.remove_rotation()
            at = Placement(work_page.rect, slide_w, slide_h)
            try:
                plan, scanned = plan_editable_page(doc, work_page)
            except Exception:
                plan, scanned = None, False
            if plan is None or scanned:
                picture_pages.append(number)
                reason = ("This page is a scanned image, so it was kept as a picture." if scanned
                          else "This page could not be rebuilt as editable content, so it was kept as a picture.")
                _visual_slide(prs, layout, page, Placement(page.rect, slide_w, slide_h), dpi, number, note=reason)
            else:
                _editable_slide(prs, layout, doc, work_page, at, dpi, number, plan)
        prs.core_properties.title = (doc.metadata or {}).get("title") or title or "Converted PDF"
        prs.core_properties.comments = f"Converted from PDF by Doxera ({mode} mode)."
        prs.save(output_path)
        return {"slides": page_count, "mode": mode, "picture_pages": picture_pages, "slide_size": (slide_w, slide_h)}
    finally:
        if work is not None:
            work.close()
        doc.close()
