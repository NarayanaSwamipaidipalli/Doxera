"""Overlay recognized glyphs on the original pages and verify the saved PDF."""
import math
import os
import re
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image, ImageDraw

from .split_tools import UserFacingError


def readable(text):
    return any(char.isalnum() for char in text)


def segmentation_mode(image, scale):
    # Automatic page layout can classify one short CJK line as isolated graphics.
    # Use single-line recognition only for a short continuous horizontal band of ink.
    ink = image.point(lambda shade: 255 if shade < 160 else 0)
    bounds = ink.getbbox()
    if bounds:
        left, top, right, bottom = bounds
        height = bottom - top
        if height <= 64 * scale and right - left >= 1.5 * height:
            rows = bytes(ink.getprojection()[1][top:bottom])
            blank_gap = b"\x00" * max(2, round(2 * scale))
            if blank_gap not in rows:
                return 7
    return 3


def ocr_pdf(input_path: str, output_path: str, language: str = "eng") -> str:
    if not isinstance(language, str) or not re.fullmatch(r"[a-z]{3}(?:\+[a-z]{3}){0,4}", language):
        raise UserFacingError("Select a supported OCR language.")
    if not set(language.split("+")) <= (set(pytesseract.get_languages()) - {"osd"}):
        raise UserFacingError("The selected OCR language is unavailable on this worker.")
    deadline = time.monotonic() + 180
    expected_text = []
    with ExitStack() as stack:
        doc = stack.enter_context(pymupdf.open(input_path))
        if doc.needs_pass:
            raise UserFacingError("Unlock this document before running OCR.")
        if not doc.is_pdf:
            doc = stack.enter_context(pymupdf.open("pdf", doc.convert_to_pdf()))
        for page in doc:
            words = page.get_text("words")
            has_text = any(readable(word[4]) for word in words)
            if has_text and not page.get_image_info():
                expected_text.append(True)
                continue
            # Bound memory even for oversized or unusually narrow PDF pages.
            rect = page.rect
            scale = min(300 / 72, math.sqrt(12_000_000 / max(1, rect.get_area())),
                        12_000 / max(1, rect.width, rect.height))
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False, annots=False)
            with Image.frombytes("L", (pix.width, pix.height), pix.samples) as image:
                del pix
                draw = ImageDraw.Draw(image)
                for word in words:
                    box = pymupdf.Rect(word[:4]) * page.rotation_matrix * pymupdf.Matrix(scale, scale)
                    draw.rectangle((box.x0-1, box.y0-1, box.x1+1, box.y1+1), fill=255)
                if image.getextrema()[0] >= 250:
                    expected_text.append(has_text)
                    continue
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise UserFacingError("OCR exceeded the processing time limit.")
                try:
                    layer_bytes = pytesseract.image_to_pdf_or_hocr(
                        image, extension="pdf", lang=language, timeout=min(60, remaining),
                        config=f"--psm {segmentation_mode(image, scale)} --dpi {max(70, round(scale * 72))} -c textonly_pdf=1")
                except (RuntimeError, OSError) as error:
                    raise UserFacingError("OCR could not finish recognition on this page.") from error
            with pymupdf.open("pdf", layer_bytes) as layer:
                if not readable(layer[0].get_text()):
                    if not has_text:
                        raise UserFacingError("No searchable text was recognized on a nonblank page.")
                else:
                    rotation = page.rotation
                    page.set_rotation(0)
                    try:
                        page.show_pdf_page(page.rect, layer, rotate=rotation, keep_proportion=False)
                    finally:
                        page.set_rotation(rotation)
                expected_text.append(True)
        if not any(expected_text):
            raise UserFacingError("No searchable text was recognized in the document.")
        with tempfile.TemporaryDirectory(dir=Path(output_path).parent) as tmp:
            candidate = Path(tmp) / "verified.pdf"
            doc.save(candidate, garbage=4, deflate=True)
            with pymupdf.open(candidate) as output:
                if len(output) != len(expected_text) or any(needed and not readable(output[i].get_text())
                                                            for i, needed in enumerate(expected_text)):
                    raise UserFacingError("The saved OCR text layer could not be verified.")
            os.replace(candidate, output_path)
    return output_path
