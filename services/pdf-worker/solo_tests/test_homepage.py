"""Public catalog, UTF-8 and shared footer regressions; no document processing."""
from dataclasses import replace
from pathlib import Path
import unittest
from unittest.mock import patch

from solo import catalog, web


CREDIT = "Built by Narayana Swami Paidipalli and Potturi Naga Vydehi"


class HomepageTests(unittest.TestCase):
    def setUp(self):
        self.client = web.app.test_client()
        self.auth = ("owner", web.trial_password.decode("utf-8"))

    def get_page(self, path, status=200):
        response = self.client.get(path, auth=self.auth)
        self.assertEqual(response.status_code, status)
        self.assertIn("charset=utf-8", response.content_type.lower())
        text = response.data.decode("utf-8", errors="strict")
        self.assertIn('<meta charset="utf-8">', text)
        self.assertIn(CREDIT, text)
        self.assertNotIn("\ufffd", text)
        return text

    def test_home_has_23_distinct_working_tools_and_four_previews(self):
        text = self.get_page("/")
        self.assertIn("Free PDF tools that respect your privacy", text)
        self.assertIn("23 working PDF tools", text)
        self.assertNotIn("Unavailable", text)
        self.assertNotIn('href="/tools/pdf-encryption"', text)
        self.assertIn('href="/tools/protect-pdf"', text)
        working, coming = catalog.homepage_catalog()
        self.assertEqual(len(working), 23)
        self.assertEqual(len({tool.name for tool in working.values()}), 23)
        self.assertEqual(len(coming), 4)
        for slug in working.keys() | coming.keys():
            self.assertIn(catalog.CATALOG[slug]["description"], text)
        for name in catalog.UNAVAILABLE.values():
            self.assertNotIn(name, text)

    def test_disabled_tool_hides_without_removing_its_route(self):
        entry = dict(catalog.CATALOG["rotate-pdf"], enabled=False)
        with patch.dict(catalog.CATALOG, {"rotate-pdf": entry}):
            text = self.get_page("/")
            self.assertNotIn('href="/tools/rotate-pdf"', text)
            self.assertIn("22 working PDF tools", text)
            self.get_page("/tools/rotate-pdf")

    def test_coming_soon_is_capped_when_catalog_grows(self):
        entry = dict(catalog.CATALOG["ai-resume-parser"], enabled=True)
        with patch.dict(catalog.CATALOG, {"ai-resume-parser": entry}), patch.dict(
            catalog.COMING_SOON, {"ai-resume-parser": entry["name"]}
        ):
            self.assertEqual(len(catalog.homepage_catalog()[1]), 4)
            self.assertNotIn(entry["name"], self.get_page("/"))

    def test_unicode_tool_name_survives_json_and_html(self):
        name = "R\u00e9sum\u00e9 Parser"
        self.assertEqual(catalog.CATALOG["ai-resume-parser"]["name"], name)
        self.assertEqual(catalog.UNAVAILABLE["ai-resume-parser"], name)
        # A future registered tool must render the same Unicode name in HTML.
        with patch.dict(catalog.TOOLS, {"rotate-pdf": replace(catalog.TOOLS["rotate-pdf"], name=name)}):
            self.assertIn(name, self.get_page("/tools/rotate-pdf"))

    def test_footer_on_all_tools_about_terms_and_error_pages(self):
        for slug in catalog.TOOLS:
            self.get_page("/tools/" + slug)
        text = self.get_page("/about")
        self.assertIn("built and maintained by Narayana Swami Paidipalli and Potturi Naga Vydehi", text)
        self.assertIn("roughnarayana@gmail.com", text)
        self.get_page("/terms-and-privacy")
        self.get_page("/missing-page", 404)
        self.get_page("/tools/ai-resume-parser", 404)

    def test_site_sources_templates_and_config_are_utf8(self):
        worker = Path(catalog.__file__).resolve().parents[1]
        suffixes = {".py", ".ts", ".tsx", ".html", ".css", ".json", ".yaml", ".yml", ".cjs", ".txt"}
        markers = ("\u00c3\u00a9", "\u00c2\u00a0", "\u00e2\u20ac\u2122", "\ufffd")
        for folder in ("solo", "ui/src", "ui/public", "app"):
            for path in (worker / folder).rglob("*"):
                if not path.is_file() or path.suffix not in suffixes:
                    continue
                text = path.read_bytes().decode("utf-8", errors="strict")
                self.assertFalse(any(marker in text for marker in markers), str(path))


if __name__ == "__main__":
    unittest.main()
