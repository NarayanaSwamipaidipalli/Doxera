import base64
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from app.processors.sign_tools import _decode_signature_image
from app.processors.split_tools import UserFacingError
from app.upload_verification import InvalidUpload, check_format


class ParserBoundary(unittest.TestCase):
    def test_format_and_dimension_checks_precede_image_verification(self):
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "sample.png"
            Image.new("RGB", (16, 16), "blue").save(path)
            with patch("PIL.PngImagePlugin.PngImageFile.verify") as verify:
                with self.assertRaises(InvalidUpload):
                    check_format(path, path.name, "image/png", max_image_pixels=255)
                verify.assert_not_called()
                check_format(path, path.name, "image/png", max_image_pixels=256)
                verify.assert_called_once()

    def test_signature_uses_only_its_declared_decoder(self):
        source = io.BytesIO()
        Image.new("RGB", (12, 12), "blue").save(source, format="PNG")
        image = base64.b64encode(source.getvalue()).decode()
        with self.assertRaises(UserFacingError):
            _decode_signature_image("data:image/jpeg;base64," + image)
        with patch.object(Image, "open", wraps=Image.open) as opened:
            self.assertTrue(_decode_signature_image("data:image/png;base64," + image))
        self.assertTrue(all(c.kwargs["formats"] == ("PNG",) for c in opened.call_args_list))

    def test_native_memory_budget_is_installed_before_conversion(self):
        code = ("from solo.process import restrict_process; import resource; restrict_process(); "
                "print(*resource.getrlimit(resource.RLIMIT_AS))")
        current = subprocess.check_output([sys.executable, "-c", code], text=True)
        self.assertEqual(list(map(int, current.split())), [1536 * 1024 * 1024] * 2)

    def test_word_keeps_a_jpeg2000_image_as_png(self):
        from app.processors.pdf_to_word_engine import _word_picture
        stream = io.BytesIO()
        Image.new("RGB", (36, 12), "red").save(stream, format="JPEG2000")
        raw, w, h = _word_picture({"image": stream.getvalue(), "width": 36, "height": 12, "ext": "jpx"})
        self.assertEqual((w, h), (36, 12))
        with Image.open(io.BytesIO(raw), formats=("PNG",)) as picture:
            self.assertEqual(picture.getpixel((0, 0)), (255, 0, 0))

    def test_trial_policy_page(self):
        from solo import web
        client = web.app.test_client()
        self.assertEqual(client.get("/terms-and-privacy").status_code, 401)
        response = client.get("/terms-and-privacy", auth=("owner", web.trial_password.decode()))
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Hosting logs", response.data)
        self.assertIn(b"one hour", response.data)
        self.assertIn(b"Paidipalem Narayana Swamy", response.data)
        self.assertIn(b'<time datetime="2026-11-22">22 November 2026</time>', response.data)
        self.assertIn(b"7 days", response.data)
        self.assertIn(f"mailto:{web.app.config['PRIVACY_EMAIL']}".encode(), response.data)

    def test_ruled_table_cells_survive_without_layout_model(self):
        import csv
        import pymupdf
        from app.processors.conversions import pdf_to_excel
        with tempfile.TemporaryDirectory() as scratch:
            source = Path(scratch) / "table.pdf"
            csv_path = Path(scratch) / "cells.csv"
            with pymupdf.open() as doc:
                page = doc.new_page()
                for x in (40, 160, 280):
                    page.draw_line((x, 40), (x, 160))
                for y in (40, 100, 160):
                    page.draw_line((40, y), (280, y))
                for xy, value in [((55, 70), "City"), ((175, 70), "Count"), ((55, 130), "Delhi"), ((175, 130), "12")]:
                    page.insert_text(xy, value)
                doc.save(source)
            with patch.object(pymupdf.Page, "get_layout", side_effect=AssertionError("unexpected layout inference")):
                pdf_to_excel(str(source), str(csv_path))
            with csv_path.open(encoding="utf-8-sig") as stream:
                rows = list(csv.reader(stream))
            self.assertIn(["City", "Count"], rows)
            self.assertIn(["Delhi", "12"], rows)

    def test_embedded_font_renders_in_a_saved_pdf(self):
        import pymupdf
        with pymupdf.open() as source:
            page = source.new_page(width=300, height=160)
            page.insert_font(fontname="Embedded", fontfile="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
            page.insert_text((15, 55), "Synthetic font review", fontname="Embedded", fontsize=20)
            document = source.tobytes()
        with pymupdf.open(stream=document, filetype="pdf") as result:
            self.assertIn("Synthetic font review", result[0].get_text())
            self.assertTrue(result.extract_font(result[0].get_fonts()[0][0])[3])
            self.assertLess(min(result[0].get_pixmap().samples), 100)

    def test_all_advertised_image_decoders_produce_pdf_pages(self):
        import pymupdf
        from solo.process import convert
        fixtures = (("jpg", "RGB", (235, 30, 20)), ("jpg", "CMYK", (0, 225, 230, 8)),
                    ("webp", "RGB", (235, 30, 20)), ("png", "RGBA", (235, 30, 20, 255)))
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            sources = []
            for i, (extension, mode, color) in enumerate(fixtures):
                path = root / f"input-{i}.{extension}"
                Image.new(mode, (170, 130), color).save(path)
                sources.append(path)
            convert("image-to-pdf", sources, "", root)
            with pymupdf.open(root / "download.pdf") as result:
                self.assertEqual(len(result), len(fixtures))
                for page in result:
                    pix = page.get_pixmap()
                    red, green, blue = pix.pixel(pix.width // 2, pix.height // 2)
                    self.assertGreater(red, max(green, blue) + 100)
