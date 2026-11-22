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
    sweep()
    threading.Thread(target=watch, name="temporary-file-cleanup", daemon=True).start()
