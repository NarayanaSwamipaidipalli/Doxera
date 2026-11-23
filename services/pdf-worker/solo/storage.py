import hashlib
import hmac
import ipaddress
import logging
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import time

ROOT = Path("/tmp/doxera-solo")
JOB = re.compile(r"job-([0-9]{10})-[a-zA-Z0-9_\-]+")
SWEEP_AFTER = 55 * 60


def private_root():
    ROOT.mkdir(mode=0o700, exist_ok=True)
    info = ROOT.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Unsafe scratch directory")
    return ROOT


def new_directory():
    return tempfile.TemporaryDirectory(dir=private_root(), prefix=f"job-{int(time.time())}-")


def sweep(now=None):
    now = time.time() if now is None else now
    for entry in private_root().iterdir():
        match = JOB.fullmatch(entry.name)
        if match and now - int(match[1]) >= SWEEP_AFTER and not entry.is_symlink():
            try:
                shutil.rmtree(entry)
            except FileNotFoundError:
                pass
    db = ROOT / "rate.sqlite"
    if db.is_file():
        with sqlite3.connect(db) as conn:
            conn.execute("DELETE FROM requests WHERE window < ?", (int(now // 60) - 1,))


def watch():
    while True:
        try:
            sweep()
        except (OSError, sqlite3.Error):
            logging.getLogger("gunicorn.error").error("Temporary cleanup needs a retry")
        time.sleep(15)


def limit_ip(peer, forwarded, secret, trusted):
    address = ipaddress.ip_address(peer)
    if forwarded and any(address in network for network in trusted):
        # Use the hop appended by the verified ingress; ignore caller-supplied earlier hops.
        try:
            address = ipaddress.ip_address(forwarded.rsplit(",", 1)[-1].strip())
        except ValueError:
            pass
    key = hmac.new(secret.encode(), address.packed, hashlib.sha256).digest()
    window = int(time.time() // 60)
    conn = sqlite3.connect(private_root() / "rate.sqlite", timeout=2)
    try:
        with conn:
            conn.execute("CREATE TABLE IF NOT EXISTS requests (ip BLOB, window INTEGER, count INTEGER, PRIMARY KEY(ip,window))")
            row = conn.execute("INSERT INTO requests VALUES (?, ?, 1) ON CONFLICT(ip,window) DO UPDATE SET count=count+1 RETURNING count",
                               (key, window)).fetchone()
        return row[0] <= 10
    finally:
        conn.close()
