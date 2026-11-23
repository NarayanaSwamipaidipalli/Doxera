"""Offline tests. Run in a fresh solo test container with a private /tmp."""
import base64
import concurrent.futures
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from werkzeug.exceptions import RequestEntityTooLarge
from solo import storage
from solo import web


class SoloSafeguards(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        scope = patch.object(storage, "ROOT", Path(self.scratch.name) / "service")
        scope.start()
        self.addCleanup(scope.stop)

    def test_expiry_keeps_new_jobs_and_unrelated_paths(self):
        root = storage.private_root()
        now = int(time.time())
        for age in (60, 3350, 3600):
            job = root / f"job-{now-age}-sample"
            job.mkdir()
            (job / "source.pdf").write_bytes(b"fixture")
        outside = Path(self.scratch.name) / "preserved"
        outside.mkdir()
        (outside / "control").write_bytes(b"fixture")
        (root / f"job-{now-4000}-link").symlink_to(outside)
        storage.sweep(now)
        self.assertTrue((root/f"job-{now-60}-sample/source.pdf").exists())
        self.assertTrue((outside/"control").is_file())
        self.assertFalse((root/f"job-{now-3350}-sample").exists())
        self.assertFalse((root/f"job-{now-3600}-sample").exists())

    def test_file_limit_measures_actual_streamed_bytes(self):
        with web.LimitedUpload(max_size=1024,dir=self.scratch.name) as stream:
            for _ in range(50):
                stream.write(b"x"*1_000_000)
            self.assertEqual(stream.tell(),50_000_000)
            with self.assertRaises(RequestEntityTooLarge):
                stream.write(b"x")

    def test_atomic_rate_limit_and_spoofed_forwarding(self):
        def hit(i):
            return storage.limit_ip("192.0.2.1",f"203.0.113.{i}","fixture",[])
        with concurrent.futures.ThreadPoolExecutor(4) as workers:
            self.assertEqual(sum(workers.map(hit,range(20))),10)
        self.assertTrue(storage.limit_ip("192.0.2.2",None,"fixture",[]))

    def test_no_upload_without_matching_session(self):
        client = web.app.test_client()
        client.environ_base["HTTP_AUTHORIZATION"] = "Basic " + base64.b64encode(b"owner:" + web.trial_password).decode()
        self.assertEqual(client.post("/tools/compress-pdf").status_code,403)
        client.get("/tools/compress-pdf",base_url="https://localhost")
        self.assertEqual(client.post("/tools/compress-pdf",data={"csrf":"wrong"},base_url="https://localhost").status_code,403)
        self.assertEqual(list(storage.ROOT.glob("job-*")),[])

    def test_converter_has_no_internet_socket(self):
        code = ("from solo.process import restrict_process; import socket; restrict_process(); "
                "socket.socket(socket.AF_INET,socket.SOCK_STREAM)")
        run = subprocess.run([sys.executable,"-c",code],capture_output=True)
        self.assertNotEqual(run.returncode,0)
        self.assertIn(b"Operation not permitted",run.stderr)

    def test_gate_covers_site_uploads_static_and_unknown_routes(self):
        client = web.app.test_client()
        for path in ("/", "/static/tools.css", "/tools/merge-pdf", "/tools/word-to-pdf", "/unknown"):
            for method in ("GET", "POST", "HEAD", "OPTIONS"):
                response = client.open(path, method=method)
                self.assertEqual(response.status_code, 401, (path, method))
                self.assertIn("Basic", response.headers["WWW-Authenticate"])
        self.assertEqual(client.get("/health").status_code, 200)
        self.assertEqual(client.post("/health").status_code, 401)
        for auth in (("owner","invalid"), ("other",web.trial_password.decode())):
            self.assertEqual(client.get("/", auth=auth).status_code, 401)
        good = ("owner", web.trial_password.decode())
        page = client.get("/", auth=good)
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Coming soon", page.data)
        from solo.catalog import COMING_SOON
        for slug, name in COMING_SOON.items():
            self.assertIn(name.encode(), page.data)
            self.assertEqual(client.post("/tools/" + slug, auth=good).status_code, 404)

    def test_missing_trial_password_fails_closed(self):
        env = dict(os.environ)
        env.pop("SOLO_TRIAL_PASSWORD", None)
        self.assertNotEqual(subprocess.run([sys.executable,"-c","import solo.web"],env=env,capture_output=True).returncode,0)

    def test_office_and_xml_disguised_as_allowed_files_are_rejected(self):
        from solo.process import convert
        from solo.catalog import TOOLS
        self.assertEqual(len(TOOLS), 24)
        self.assertEqual(set(ext for tool in TOOLS.values() for ext in tool.extensions), {"pdf","png","jpg","jpeg","webp"})
        for ext, slug in [("pdf","compress-pdf"), ("png","image-to-pdf"), ("webp","image-to-pdf")]:
            sample = Path(self.scratch.name) / ("sample." + ext)
            for data in (b"<?xml version='1.0'?><sample/>", b"PK\x03\x04sample"):
                sample.write_bytes(data)
                with self.assertRaisesRegex(ValueError, "header"):
                    convert(slug, [sample], "medium", Path(self.scratch.name))

    def test_refuses_missing_session_secret(self):
        env = dict(os.environ)
        env.pop("SOLO_SESSION_SECRET",None)
        self.assertNotEqual(subprocess.run([sys.executable,"-c","import solo.web"],env=env,capture_output=True).returncode,0)
