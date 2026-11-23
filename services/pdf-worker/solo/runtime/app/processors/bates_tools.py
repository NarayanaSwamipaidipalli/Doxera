"""Bates numbering: stamps sequential labels such as DOX-000001 on the selected pages of one or more PDFs.

Layout (the web preview uses the same rule, apps/web/src/lib/pdf/bates.ts):
- Everything is measured in points on the page as it is displayed (after /Rotate), so rotated pages get an
  upright label in the chosen corner.
- Label box = Helvetica text width + padding (0.35 x font size) on each side; height = font size + 2 x padding.
- The box sits `margin` points from the chosen edges; if it would not fit between the margins the font shrinks.
- Only selected pages are numbered and they use consecutive numbers; with several files, numbering continues
  from one file to the next in the order given.
The sources are only read. Every result is re-opened and checked before it is accepted.
"""
from __future__ import annotations

import io
import os
import re
import zipfile
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import pymupdf

from .split_tools import UserFacingError, open_source_pdf, parse_page_spec, safe_base_name

POSITIONS = ("top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right")
LEGACY_POSITIONS = {"bottom-right": "bottom-right", "bottom-left": "bottom-left", "top-right": "top-right", "center": "bottom-center"}
MAX_AFFIX = 40
MAX_NUMBER = 999_999_999_999
PADDING_RATIO = 0.35
MIN_FONT = 4.0
_PRINTABLE = re.compile(r"^[\x20-\x7e]*$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass(frozen=True)
class BatesSettings:
    prefix: str = "DOX-"
    suffix: str = ""
    start: int = 1
    padding: int = 6
    increment: int = 1
    pages: str = ""
    position: str = "bottom-right"
    font_size: float = 10.0
    color: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    margin: float = 24.0
    background: bool = False

    def label(self, index: int) -> str:
        return f"{self.prefix}{str(self.start + index * self.increment).zfill(self.padding)}{self.suffix}"


def _integer(value, name: str, low: int, high: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        number = value
    elif isinstance(value, str) and re.fullmatch(r"\s*\d{1,15}\s*", value):
        number = int(value)
    else:
        raise UserFacingError(f"{name} must be a whole number.")
    if not low <= number <= high:
        raise UserFacingError(f"{name} must be between {low:,} and {high:,}.")
    return number


def _number(value, name: str, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise UserFacingError(f"{name} must be a number.") from None
    if not (low <= number <= high):
        raise UserFacingError(f"{name} must be between {low:g} and {high:g}.")
    return number


def _affix(value, name: str) -> str:
    text = "" if value is None else value
    if not isinstance(text, str) or not _PRINTABLE.match(text):
        raise UserFacingError(f"The {name} can use letters, digits, spaces and common symbols only.")
    if len(text) > MAX_AFFIX:
        raise UserFacingError(f"The {name} can be at most {MAX_AFFIX} characters.")
    return text


def settings_from_parameters(parameters: dict) -> BatesSettings:
    """Reads job parameters. Requests without `padding` come from older clients: their prefix gets a hyphen
    separator, as before, and the old position names are mapped to the new presets."""
    p = parameters or {}
    legacy = "padding" not in p
    prefix = _affix(p.get("prefix", "BATES" if legacy else "DOX-"), "prefix")
    if legacy and prefix and not prefix.endswith(("-", "_", " ", ".")):
        prefix += "-"
    position = p.get("position", "bottom-right")
    position = LEGACY_POSITIONS.get(position, position) if legacy else position
    if position not in POSITIONS:
        raise UserFacingError("Choose a position: top or bottom, left, centre or right.")
    color = p.get("color", "#000000")
    if not isinstance(color, str) or not _HEX.match(color):
        raise UserFacingError("The colour must be a hex value such as #000000.")
    pages = p.get("pages", "")
    if pages is None:
        pages = ""
    if not isinstance(pages, str):
        raise UserFacingError("Page selection must be text such as 1-3, 5.")
    background = p.get("background", False)
    if not isinstance(background, bool):
        raise UserFacingError("The background option must be on or off.")
    return BatesSettings(
        prefix=prefix,
        suffix=_affix(p.get("suffix", ""), "suffix"),
        start=_integer(p.get("startNumber", 1), "The starting number", 0, MAX_NUMBER),
        padding=_integer(p.get("padding", 6), "Padding", 0, 12),
        increment=_integer(p.get("increment", 1), "The increment", 1, 1000),
        pages=pages.strip(),
        position=position,
        font_size=_number(p.get("fontSize", 10), "Font size", 6, 36),
        color=tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)),
        margin=_number(p.get("margin", 24), "The margin", 0, 144),
        background=background,
    )


def layout(text: str, font_size: float, width: float, height: float, position: str, margin: float):
    """Returns (box, baseline origin, font size used) in displayed-page coordinates."""
    size = font_size
    available = max(width - 2 * margin, 1.0)
    natural = pymupdf.get_text_length(text, fontname="helv", fontsize=size) + 2 * PADDING_RATIO * size
    if natural > available:
        size = max(MIN_FONT, size * available / natural)
    pad = PADDING_RATIO * size
    box_w = pymupdf.get_text_length(text, fontname="helv", fontsize=size) + 2 * pad
    box_h = size + 2 * pad
    vertical, horizontal = position.split("-")
    x = margin if horizontal == "left" else width - margin - box_w if horizontal == "right" else (width - box_w) / 2
    y = margin if vertical == "top" else height - margin - box_h
    box = pymupdf.Rect(x, y, x + box_w, y + box_h)
    return box, pymupdf.Point(x + pad, y + pad + size * 0.78), size


def _stamp(page: "pymupdf.Page", text: str, s: BatesSettings) -> None:
    visible = page.rect
    box, origin, size = layout(text, s.font_size, visible.width, visible.height, s.position, s.margin)
    to_page = page.derotation_matrix
    if s.background:
        page.draw_rect(box * to_page, color=None, fill=(1, 1, 1), overlay=True)
    page.insert_text(origin * to_page, text, fontsize=size, fontname="helv", color=s.color, rotate=page.rotation)


def _facts(doc: "pymupdf.Document"):
    return [(round(p.rect.width, 1), round(p.rect.height, 1), p.rotation) for p in doc]


def number_documents(input_paths: Sequence[str], settings: BatesSettings) -> List[Tuple[bytes, List[Tuple[int, str]]]]:
    """Stamps every document in order with continuous numbers. Returns (pdf bytes, [(page, label)]) per document."""
    results = []
    counter = 0
    for path in input_paths:
        doc = open_source_pdf(path, action="add Bates numbers")
        try:
            indices = parse_page_spec(settings.pages, doc.page_count) if settings.pages else list(range(doc.page_count))
            before = _facts(doc)
            stamped = []
            for index in indices:
                text = settings.label(counter)
                if settings.start + counter * settings.increment > MAX_NUMBER:
                    raise UserFacingError("The Bates numbers would go past 999,999,999,999. Use a smaller start or increment.")
                _stamp(doc[index], text, settings)
                stamped.append((index + 1, text))
                counter += 1
            data = doc.tobytes(garbage=1, deflate=True)
        finally:
            doc.close()
        check = pymupdf.open(stream=data, filetype="pdf")
        try:
            ok = _facts(check) == before and all(text in check[page - 1].get_text() for page, text in stamped)
        finally:
            check.close()
        if not ok:
            raise UserFacingError("Bates numbering failed: the stamped PDF did not pass its checks. Please try again.")
        results.append((data, stamped))
    return results


def apply_bates(input_paths: Sequence[str], output_pdf_path: str, parameters: dict, names: Optional[Sequence[str]] = None) -> str:
    """Writes one PDF (single input) or a ZIP of `<name>-bates-numbered.pdf` files. Returns the path written."""
    settings = settings_from_parameters(parameters)
    results = number_documents(input_paths, settings)
    if len(results) == 1:
        with open(output_pdf_path, "wb") as handle:
            handle.write(results[0][0])
        return output_pdf_path
    zip_path = os.path.splitext(output_pdf_path)[0] + ".zip"
    used = set()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for i, (data, _) in enumerate(results):
            base = safe_base_name((names or [])[i] if names and i < len(names) else f"document-{i + 1}")
            name, n = f"{i + 1:02d}-{base}-bates-numbered.pdf", 1
            while name in used:
                n += 1
                name = f"{i + 1:02d}-{base}-{n}-bates-numbered.pdf"
            used.add(name)
            archive.writestr(name, data)
    return zip_path
