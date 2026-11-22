"""Offline tests. Run in a fresh solo test container with a private /tmp."""
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

    def test_refuses_missing_session_secret(self):
        env = dict(os.environ)
        env.pop("SOLO_SESSION_SECRET",None)
        self.assertNotEqual(subprocess.run([sys.executable,"-c","import solo.web"],env=env,capture_output=True).returncode,0)
