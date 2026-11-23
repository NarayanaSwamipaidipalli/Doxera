"""A generated five-page scan exercises the same compression code as the web worker."""
import io
from pathlib import Path
import random
import tempfile
import unittest

from PIL import Image
import pymupdf

from app.processors.basic_tools import CompressionNotSmaller, compress_pdf


def make_scan(path):
    # Five distinct JPEGs prevent PDF object deduplication from faking a saving.
    noise = random.Random(154)
    with pymupdf.open() as doc:
        for _ in range(5):
            image = Image.frombytes("L", (1200, 1600), noise.randbytes(1200 * 1600))
            image = image.resize((3000, 4000), Image.Resampling.BILINEAR)
            image = image.point(lambda value: 65 + int(value * 0.27)).convert("RGB")
            jpeg = io.BytesIO()
            image.save(jpeg, format="JPEG", quality=98)
            page = doc.new_page(width=540, height=720)
            page.insert_image(page.rect, stream=jpeg.getvalue())
        doc.save(path)


def image_dpis(path):
    with pymupdf.open(path) as doc:
        assert len(doc) == 5
        results = []
        for page in doc:
            info, = page.get_image_info(xrefs=True)
            box = pymupdf.Rect(info["bbox"])
            assert doc.extract_image(info["xref"])["ext"] == "jpeg"
            results.append((info["width"] * 72 / box.width, info["height"] * 72 / box.height))
        return results


class ScanCompression(unittest.TestCase):
    def test_image_heavy_scan(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "scan.pdf"
            make_scan(source)
            self.assertGreater(source.stat().st_size, 20_000_000)
            self.assertLess(source.stat().st_size, 50_000_000)
            sizes = {}
            for level, dpi in [("high", 150), ("medium", 200)]:
                dest = Path(temp) / (level + ".pdf")
                compress_pdf(str(source), str(dest), level)
                sizes[level] = dest.stat().st_size
                for horizontal, vertical in image_dpis(dest):
                    self.assertAlmostEqual(horizontal, dpi, delta=2)
                    self.assertAlmostEqual(vertical, dpi, delta=2)
            self.assertLessEqual(sizes["high"], source.stat().st_size // 2)
            self.assertLess(sizes["high"], sizes["medium"])

    def test_already_optimized_file_reports_no_savings(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "blank.pdf"
            with pymupdf.open() as doc:
                doc.new_page()
                doc.save(source, garbage=4, deflate=True, use_objstms=1, no_new_id=True)
            with self.assertRaises(CompressionNotSmaller):
                compress_pdf(str(source), str(Path(temp) / "result.pdf"), "high")
