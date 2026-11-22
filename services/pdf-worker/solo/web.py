import fcntl
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
from datetime import timedelta
from urllib.parse import urlsplit

from flask import Flask, Request, abort, render_template, request, send_file, session
from werkzeug.exceptions import RequestEntityTooLarge
from solo.catalog import TOOLS, UNAVAILABLE
from solo.storage import limit_ip, private_root, new_directory

FILE_LIMIT = 50_000_000  # Decimal MB, as displayed to users.


class LimitedUpload(tempfile.SpooledTemporaryFile):
    def write(self, data):
        if self.tell() + len(data) > FILE_LIMIT:
            raise RequestEntityTooLarge()
        return super().write(data)


class UploadRequest(Request):
    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        return LimitedUpload(max_size=128_000, mode="w+b", dir=private_root())


app = Flask(__name__)
app.request_class = UploadRequest
key = os.environ.get("SOLO_SESSION_SECRET", "")
if len(key) < 32:
    raise RuntimeError("Supply a random SOLO_SESSION_SECRET of at least 32 characters")
app.config.update(SECRET_KEY=key, SESSION_COOKIE_NAME="__Host-doxera_solo", SESSION_COOKIE_SECURE=True,
                  SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict", PERMANENT_SESSION_LIFETIME=timedelta(hours=1),
                  MAX_CONTENT_LENGTH=100_100_000, MAX_FORM_PARTS=12, MAX_FORM_MEMORY_SIZE=128_000)
trusted = [ipaddress.ip_network(value.strip()) for value in os.getenv("SOLO_TRUSTED_PROXY_CIDRS","").split(",") if value.strip()]
source = os.getenv("SOLO_SOURCE_URL", "")
if source and (urlsplit(source).scheme != "https" or not urlsplit(source).hostname or urlsplit(source).username):
    raise RuntimeError("Use an approved HTTPS source URL")
app.config["SOURCE_URL"] = source
contact = os.getenv("SOLO_PRIVACY_EMAIL", "")
if contact and not re.fullmatch(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", contact, re.ASCII):
    raise RuntimeError("Use a valid public privacy email address")
app.config["PRIVACY_EMAIL"] = contact


@app.after_request
def headers(response):
    response.headers.update({"Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff",
        "Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})
    return response


@app.get("/health")
def health():
    return {"status":"ok"}


@app.get("/")
def home():
    return render_template("tools.html", tools=TOOLS, unavailable=UNAVAILABLE)


@app.get("/tools/<slug>")
def tool_page(slug):
    if slug not in TOOLS:
        abort(404)
    session.permanent = True
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return render_template("tools.html", tool=TOOLS[slug], slug=slug)


@app.errorhandler(413)
def too_large(_):
    return render_template("tools.html", error="Each file must be 50 MB or smaller. Use at most 100 MB per request."), 413


def process(slug, folder, option):
    env = {"PATH":os.defpath + ":/usr/local/bin", "PYTHONPATH":"/app", "HOME":str(folder), "TMPDIR":str(folder),
           "LANG":"C.UTF-8", "OPENBLAS_NUM_THREADS":"1", "OMP_THREAD_LIMIT":"1", "PYTHONDONTWRITEBYTECODE":"1",
           "SOLO_PARENT_PID":str(os.getpid()), "HTML_CONVERSION_TIMEOUT_SECONDS":"70", "OFFICE_CONVERSION_TIMEOUT_SECONDS":"70"}
    # The converter never receives the signed session secret or an original file name.
    with subprocess.Popen([sys.executable,"-m","solo.process"], cwd=folder, env=env, stdin=subprocess.PIPE,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True) as child:
        try:
            child.communicate(json.dumps({"tool":slug,"option":option}).encode(), timeout=90)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            abort(422, "Conversion exceeded the time limit. Try a smaller file.")
        if child.returncode:
            abort(422, "Conversion failed. Check the document type, page selection or password, or try a smaller file.")


@app.errorhandler(422)
@app.errorhandler(429)
@app.errorhandler(503)
@app.errorhandler(403)
def failed(error):
    return render_template("tools.html", error=error.description), error.code


@app.post("/tools/<slug>")
def run_tool(slug):
    tool = TOOLS.get(slug)
    if not tool:
        abort(404)
    try:
        accepted = limit_ip(request.remote_addr, request.headers.get("X-Forwarded-For"), key, trusted)
    except (ValueError, OSError, sqlite3.Error):
        abort(503, "Try again shortly.")
    if not accepted:
        abort(429, "Too many requests. Please wait a minute.")
    if not session.get("csrf"):
        abort(403, "Open the tool in this browser before uploading.")
    with (private_root() / "conversion.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            abort(503, "Another conversion is running. Please try again shortly.")
        if shutil.disk_usage(private_root()).free < 500_000_000:
            abort(503, "Temporary space is full. Try again shortly.")
        if not hmac.compare_digest(request.form.get("csrf","").encode(), session["csrf"].encode()):
            abort(403, "Your session expired. Reopen the tool.")
        uploads = request.files.getlist("files")
        if not tool.minimum <= len(uploads) <= tool.maximum:
            abort(422, f"Choose {tool.minimum} to {tool.maximum} supported files.")
        option = request.form.get("option", "")
        if tool.prompt and (not option.strip() or len(option) > 500 or tool.choices and option not in tool.choices):
            abort(422, "Enter a valid tool setting.")
        with new_directory() as name:
            folder = Path(name)
            for i, upload in enumerate(uploads):
                extension = Path(upload.filename or "").suffix[1:].lower()
                if extension not in tool.extensions:
                    abort(422, "This file type is unsupported for the selected tool.")
                target = folder / f"input-{i}.{extension}"
                upload.save(target)
                upload.close()
            process(slug, folder, option)
            outputs = list(folder.glob("download.*"))
            if len(outputs) != 1 or outputs[0].is_symlink():
                abort(422, "No valid output was produced.")
            output = outputs[0]
            stream = output.open("rb")
            try:
                response = send_file(stream, as_attachment=True, download_name=slug + output.suffix,
                                     conditional=False, etag=False)
                response.content_length = os.fstat(stream.fileno()).st_size
            except BaseException:
                stream.close()
                raise
        # On Linux the pathname is gone before streaming; WSGI closes the descriptor at EOF/disconnect.
        return response
