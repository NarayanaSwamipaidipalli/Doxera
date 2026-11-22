"""Reclaim this worker's abandoned job directories without touching a live task."""
import fcntl
import logging
import os
import re
import shutil
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from celery.signals import heartbeat_sent

from app.config import settings


_JOB_DIRECTORY = re.compile(r"doxera-job-[0-9a-f-]{36}-[\w-]{8}$")
_last_sweep = float("-inf")
logger = logging.getLogger(__name__)


def sweep(root, now):
    eligible = 0
    for path in Path(root).glob("doxera-job-*"):
        if not _JOB_DIRECTORY.fullmatch(path.name):
            continue
        try:
            fd = os.open(path, os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if os.fstat(fd).st_mtime > now - settings.TEMP_FILE_RETENTION_HOURS * 3600:
                    continue
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                eligible += 1
                if settings.RETENTION_MODE == "enforce":
                    shutil.rmtree(path)
            finally:
                os.close(fd)
        except (BlockingIOError, FileNotFoundError, NotADirectoryError):
            continue
        except OSError:
            logger.warning("Could not remove an abandoned processing directory")
    if eligible:
        logger.info("Abandoned processing directories mode=%s count=%d", settings.RETENTION_MODE, eligible)
    return eligible


@heartbeat_sent.connect
def sweep_periodically(**kwargs):
    global _last_sweep
    if time.monotonic() - _last_sweep > 900:
        _last_sweep = time.monotonic()
        sweep(settings.TMP_STORAGE_DIR, time.time())


@contextmanager
def job_directory(root, job_id):
    sweep_periodically()
    os.makedirs(root, exist_ok=True)
    path = tempfile.mkdtemp(prefix=f"doxera-job-{job_id}-", dir=root)
    fd = os.open(path, os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield path
    finally:
        try:
            shutil.rmtree(path)
        except OSError:
            logger.warning("Processing directory cleanup deferred")
        finally:
            os.close(fd)
