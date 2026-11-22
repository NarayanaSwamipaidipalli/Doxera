import threading
from solo.storage import sweep, watch

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
    from pathlib import Path
    import shutil
    import pymupdf
    native_library = Path(pymupdf.__file__).with_name("libmupdf.so.28.6")
    with native_library.open("rb") as library:
        server.log.info("MuPDF runtime sha256=%s", hashlib.file_digest(library, "sha256").hexdigest())
    server.log.info("PDF compression engine=PyMuPDF version=%s rewrite_images=%s ghostscript=%s",
                    pymupdf.__version__, hasattr(pymupdf.Document, "rewrite_images"),
                    shutil.which("gs") or "absent")
    sweep()
    threading.Thread(target=watch, name="temporary-file-cleanup", daemon=True).start()
