"""Optional beacon rendering/CSP and independent, fail-closed admin authentication."""
from html.parser import HTMLParser
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from solo import usage, web


class Scripts(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.beacons = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src") == "https://static.cloudflareinsights.com/beacon.min.js":
            self.beacons.append(attrs)


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        scope = patch.object(usage, "LOCAL_DIRECTORY", Path(scratch.name))
        scope.start()
        self.addCleanup(scope.stop)
        scope = patch.object(usage, "DATA_DIRECTORY", Path(scratch.name) / "not-mounted")
        scope.start()
        self.addCleanup(scope.stop)
        scope = patch.dict(web.app.config, ADMIN_PASSWORD="private-admin-password", CF_ANALYTICS_TOKEN="")
        scope.start()
        self.addCleanup(scope.stop)
        self.client = web.app.test_client()
        self.owner = ("owner", web.trial_password.decode("utf-8"))
        self.admin = ("admin", "private-admin-password")

    def test_beacon_absent_without_token_and_csp_stays_local(self):
        for path in ("/", "/tools/rotate-pdf", "/about", "/terms-and-privacy", "/missing"):
            response = self.client.get(path, auth=self.owner)
            self.assertEqual(Scripts(response.get_data(as_text=True)).beacons, [])
            self.assertNotIn("cloudflareinsights.com", response.headers["Content-Security-Policy"])

    def test_one_beacon_on_react_server_admin_and_error_pages(self):
        with patch.dict(web.app.config, CF_ANALYTICS_TOKEN="synthetic-public-token"):
            for path in ("/", "/tools/rotate-pdf", "/about", "/terms-and-privacy", "/missing", "/admin/stats"):
                response = self.client.get(path, auth=self.admin if path.startswith("/admin") else self.owner)
                scripts = Scripts(response.get_data(as_text=True)).beacons
                self.assertEqual(len(scripts), 1, path)
                self.assertIn("defer", scripts[0])
                self.assertEqual(json.loads(scripts[0]["data-cf-beacon"]), {"token": "synthetic-public-token"})
                directives = dict(part.strip().split(" ", 1) for part in response.headers["Content-Security-Policy"].split(";") if " " in part.strip())
                self.assertIn("https://static.cloudflareinsights.com", directives["script-src"])
                self.assertIn("https://cloudflareinsights.com", directives["connect-src"])
                self.assertNotIn("unsafe-inline", directives["script-src"])

    def test_token_is_json_and_attribute_escaped(self):
        token = "token'\"><script>alert(1)</script>"
        with patch.dict(web.app.config, CF_ANALYTICS_TOKEN=token):
            text = self.client.get("/about", auth=self.owner).get_data(as_text=True)
        self.assertNotIn(token, text)
        self.assertEqual(json.loads(Scripts(text).beacons[0]["data-cf-beacon"]), {"token": token})

    def test_admin_page_is_disabled_without_password(self):
        with patch.dict(web.app.config, ADMIN_PASSWORD=""):
            self.assertEqual(self.client.get("/admin/stats", auth=self.admin).status_code, 404)
        self.assertFalse(usage.database_path().exists())

    def test_admin_challenges_missing_wrong_and_trial_credentials(self):
        for credentials in (None, ("admin", "wrong"), ("other", "private-admin-password"), self.owner):
            response = self.client.get("/admin/stats", auth=credentials)
            self.assertEqual(response.status_code, 401)
            self.assertIn('Basic realm="Doxera statistics"', response.headers["WWW-Authenticate"])
            self.assertNotIn("Total uses per tool", response.get_data(as_text=True))
            self.assertNotIn("private-admin-password", response.get_data(as_text=True))
        self.assertFalse(usage.database_path().exists())

    def test_authorized_stats_include_all_23_tools_and_30_days(self):
        usage.record_tool_use("rotate-pdf", True)
        usage.record_tool_use("rotate-pdf", False)
        response = self.client.get("/admin/stats", auth=self.admin)
        self.assertEqual(response.status_code, 200)
        text = response.get_data(as_text=True)
        self.assertIn("Total uses per tool", text)
        self.assertIn("Uses per day: last 30 days", text)
        self.assertEqual(text.count('<time datetime="'), 30)
        self.assertEqual(text.count('<th scope="row">'), 53)
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertIn("noindex", response.headers["X-Robots-Tag"])
        self.assertNotIn("Set-Cookie", response.headers)
        self.assertNotIn("private-admin-password", text)
        self.assertIn("cookie-free usage statistics", text)

    def test_admin_unicode_password_and_trailing_slash(self):
        with patch.dict(web.app.config, ADMIN_PASSWORD="long-p\u00e4ssword"):
            response = self.client.get("/admin/stats/", auth=("admin", "long-p\u00e4ssword"))
        self.assertEqual(response.status_code, 200)

    def test_database_failure_is_a_private_503(self):
        with patch.object(usage, "read_stats", side_effect=sqlite3.OperationalError("private filesystem details")), \
             self.assertLogs("gunicorn.error", level="ERROR"):
            response = self.client.get("/admin/stats", auth=self.admin)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private filesystem details", response.get_data(as_text=True))

    def test_about_and_privacy_copy(self):
        response = self.client.get("/about", auth=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertIn("About Doxera", response.get_data(as_text=True))
        text = self.client.get("/terms-and-privacy", auth=self.owner).get_data(as_text=True)
        self.assertIn("anonymous, cookie-free usage statistics", text)
        self.assertIn("one-hour file deletion period does not apply", text)


if __name__ == "__main__":
    unittest.main()
