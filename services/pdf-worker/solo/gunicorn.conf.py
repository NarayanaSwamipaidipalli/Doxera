import tempfile
import threading
import time
from pathlib import Path
from solo.storage import new_directory, private_root, sweep, watch

workers = 2
worker_class = "sync"
control_socket_disable = True
umask = 0o077
accesslog = None
worker_tmp_dir = "/tmp"
limit_request_line = 4094
limit_request_fields = 32


def when_ready(server):
    import hashlib
    import shutil
    import pymupdf
    native_library = Path(pymupdf.__file__).with_name("libmupdf.so.28.6")
    with native_library.open("rb") as library:
        server.log.info("MuPDF runtime sha256=%s", hashlib.file_digest(library, "sha256").hexdigest())
    server.log.info("PDF compression engine=PyMuPDF version=%s rewrite_images=%s ghostscript=%s",
                    pymupdf.__version__, hasattr(pymupdf.Document, "rewrite_images"),
                    shutil.which("gs") or "absent")
    # Verify the existing startup sweep on this instance's scratch filesystem.
    prefix = f"job-{int(time.time()) - 59 * 60}-"
    with tempfile.TemporaryDirectory(dir=private_root(), prefix=prefix) as expired, new_directory() as fresh:
        (Path(expired) / "input-0.pdf").touch()
        (Path(expired) / "download.pdf").touch()
        control = Path(fresh) / "input-0.pdf"
        control.touch()
        sweep()
        if Path(expired).exists() or not control.is_file():
            raise RuntimeError("Temporary file cleanup startup check failed")
    server.log.info("Temporary cleanup verified: expired synthetic input and output removed at age 59 minutes; fresh job preserved")
    threading.Thread(target=watch, name="temporary-file-cleanup", daemon=True).start()
