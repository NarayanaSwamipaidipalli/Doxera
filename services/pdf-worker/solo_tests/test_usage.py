"""Anonymous aggregate storage, concurrent writes and request outcome accounting."""
import concurrent.futures
from datetime import date, datetime, timezone
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from werkzeug.exceptions import UnprocessableEntity
from solo import storage, usage, web


class UsageTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        for scope in (
            patch.object(usage, "DATA_DIRECTORY", self.root / "data"),
            patch.object(usage, "LOCAL_DIRECTORY", self.root / "local"),
            patch.object(usage, "today", return_value=date(2026, 11, 23)),
            patch.object(storage, "ROOT", self.root / "temporary-files"),
        ):
            scope.start()
            self.addCleanup(scope.stop)

    def test_mounted_disk_and_local_fallback_paths(self):
        self.assertEqual(usage.database_path(), self.root / "local/usage.db")
        usage.record_tool_use("rotate-pdf", True)
        self.assertTrue((self.root / "local/usage.db").is_file())
        (self.root / "data").mkdir()
        self.assertEqual(usage.database_path(), self.root / "data/usage.db")
        usage.record_tool_use("rotate-pdf", False)
        self.assertTrue((self.root / "data/usage.db").is_file())

    def test_only_daily_tool_and_outcome_totals_are_stored(self):
        usage.record_tool_use("rotate-pdf", True)
        usage.record_tool_use("rotate-pdf", False)
        usage.record_tool_use("rotate-pdf", True)
        with sqlite3.connect(usage.database_path()) as database:
            self.assertEqual([row[1] for row in database.execute("PRAGMA table_info(daily_usage)")],
                             ["tool", "day", "successes", "failures"])
            self.assertEqual(database.execute("SELECT * FROM daily_usage").fetchall(),
                             [("Rotate PDF", "2026-11-23", 2, 1)])
            self.assertEqual(database.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(),
                             [("daily_usage",)])

    def test_both_protection_routes_share_one_counter(self):
        usage.record_tool_use("pdf-encryption", True)
        usage.record_tool_use("protect-pdf", False)
        stats = usage.read_stats()
        protect = next(tool for tool in stats["tools"] if tool["name"] == "Protect PDF")
        self.assertEqual(protect, {"name": "Protect PDF", "total": 2, "successes": 1, "failures": 1})
        self.assertEqual(len(stats["tools"]), 23)

    def test_concurrent_workers_do_not_lose_counts(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
            list(workers.map(lambda n: usage.record_tool_use("merge-pdf", n % 2 == 0), range(80)))
        self.assertEqual(usage.read_stats()["totals"], {"total": 80, "successes": 40, "failures": 40})

    def test_last_30_days_include_zero_days_and_all_time_totals(self):
        for day, succeeded in ((date(2026, 10, 24), False), (date(2026, 10, 25), True),
                               (date(2026, 11, 23), False)):
            with patch.object(usage, "today", return_value=day):
                usage.record_tool_use("rotate-pdf", succeeded)
        stats = usage.read_stats()
        self.assertEqual(stats["totals"]["total"], 3)
        self.assertEqual(len(stats["days"]), 30)
        self.assertEqual(stats["days"][0]["day"], "2026-10-25")
        self.assertEqual(stats["days"][-1]["day"], "2026-11-23")
        self.assertEqual(sum(day["total"] for day in stats["days"]), 2)
        self.assertEqual(stats["days"][1]["total"], 0)

    def test_day_boundary_uses_india_standard_time(self):
        # Stop the deterministic-date patch just for this check.
        from solo.usage import STATS_TIMEZONE
        moment = datetime(2026, 11, 23, 19, tzinfo=timezone.utc)
        self.assertEqual(moment.astimezone(STATS_TIMEZONE).date(), date(2026, 11, 24))

    def request(self, converter, *, slug="rotate-pdf", parameters=None):
        client = web.app.test_client()
        auth = ("owner", web.trial_password.decode("utf-8"))
        client.get("/tools/" + slug, auth=auth, base_url="https://localhost")
        with client.session_transaction() as session:
            csrf = session["csrf"]
        data = {"csrf": csrf, "option": "90",
                "files": (io.BytesIO(b"%PDF-1.7\nPRIVATE_DOCUMENT_CONTENT"), "private-customer-name.pdf")}
        if parameters is not None:
            import json
            data["parameters"] = json.dumps(parameters)
        if slug == "compare-pdf":
            data["files"] = [data["files"], (io.BytesIO(b"%PDF-1.7\nSECOND_PRIVATE_DOCUMENT"), "private-second.pdf")]
        with patch.object(web, "process", side_effect=converter), patch.object(web, "limit_ip", return_value=True):
            response = client.post("/tools/" + slug, data=data, auth=auth, base_url="https://localhost")
            response.get_data()
            response.close()
        return response

    def successful_conversion(self, slug, folder, option, parameters):
        (folder / "download.pdf").write_bytes(b"%PDF-1.7\nSynthetic result")

    def test_success_records_once_and_never_records_document_or_network_data(self):
        response = self.request(self.successful_conversion)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(usage.read_stats()["totals"], {"total": 1, "successes": 1, "failures": 0})
        raw = usage.database_path().read_bytes()
        for private in (b"PRIVATE_DOCUMENT_CONTENT", b"private-customer-name.pdf", b"127.0.0.1", b"localhost"):
            self.assertNotIn(private, raw)

    def test_processor_failure_counts_once(self):
        response = self.request(UnprocessableEntity("Synthetic conversion failure"))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(usage.read_stats()["totals"], {"total": 1, "successes": 0, "failures": 1})

    def test_invalid_processor_output_counts_as_failure(self):
        response = self.request(lambda *args: None)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(usage.read_stats()["totals"]["failures"], 1)

    def test_unexpected_processor_error_counts_as_failure(self):
        with patch.dict(web.app.config, PROPAGATE_EXCEPTIONS=False), self.assertLogs(web.app.logger, level="ERROR"):
            response = self.request(RuntimeError("Synthetic unexpected error"))
        self.assertEqual(response.status_code, 500)
        self.assertEqual(usage.read_stats()["totals"]["failures"], 1)

    def test_report_download_is_also_counted(self):
        def report(slug, folder, option, parameters):
            self.successful_conversion(slug, folder, option, parameters)
            (folder / "summary.json").write_text("{}", encoding="utf-8")
        response = self.request(report, slug="compare-pdf", parameters={})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content_type.startswith("multipart/form-data"))
        self.assertEqual(usage.read_stats()["totals"]["successes"], 1)

    def test_preprocessing_rejections_and_page_views_are_not_counted(self):
        client = web.app.test_client()
        auth = ("owner", web.trial_password.decode("utf-8"))
        client.get("/", auth=auth)
        with patch.object(web, "limit_ip", return_value=True):
            self.assertEqual(client.post("/tools/rotate-pdf", auth=auth).status_code, 403)
        with patch.object(web, "limit_ip", return_value=False):
            self.assertEqual(client.post("/tools/rotate-pdf", auth=auth).status_code, 429)
        self.assertFalse(usage.database_path().exists())

    def test_analytics_storage_failure_does_not_break_downloads(self):
        with patch.object(usage, "record_tool_use", side_effect=sqlite3.OperationalError("read-only test database")), \
             self.assertLogs("gunicorn.error", level="ERROR") as logs:
            response = self.request(self.successful_conversion)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(logs.output, ["ERROR:gunicorn.error:Anonymous tool usage count could not be saved"])


if __name__ == "__main__":
    unittest.main()
