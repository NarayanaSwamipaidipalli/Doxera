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
    import shutil
    import pymupdf
    server.log.info("PDF compression engine=PyMuPDF version=%s rewrite_images=%s ghostscript=%s",
                    pymupdf.__version__, hasattr(pymupdf.Document, "rewrite_images"),
                    shutil.which("gs") or "absent")
    sweep()
    threading.Thread(target=watch, name="temporary-file-cleanup", daemon=True).start()
