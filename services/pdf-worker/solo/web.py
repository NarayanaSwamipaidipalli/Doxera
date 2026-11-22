import fcntl
import hmac
import ipaddress
import json
import logging
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

from flask import Flask, Request, Response, abort, render_template, request, send_file, session
from werkzeug.exceptions import RequestEntityTooLarge
from solo.catalog import TOOLS, UNAVAILABLE, COMING_SOON
from solo.storage import limit_ip, private_root, new_directory

logger = logging.getLogger("gunicorn.error")

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
source_revision = os.getenv("RENDER_GIT_COMMIT") or os.getenv("SOLO_SOURCE_REVISION", "")
if source_revision and not re.fullmatch(r"[0-9a-f]{40}", source_revision):
    raise RuntimeError("Supply a full Git commit for the corresponding source")
app.config["SOURCE_URL"] = (
    f"https://github.com/NarayanaSwamipaidipalli/Doxera/archive/{source_revision}.tar.gz"
    if source_revision else "https://github.com/NarayanaSwamipaidipalli/Doxera/archive/refs/tags/solo-v1.0.0-rc.4.tar.gz"
)
contact = os.getenv("SOLO_PRIVACY_EMAIL") or "roughnarayana@gmail.com"
if contact and not re.fullmatch(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", contact, re.ASCII):
    raise RuntimeError("Use a valid public privacy email address")
app.config["PRIVACY_EMAIL"] = contact


access_mode = os.environ.get("SOLO_ACCESS_MODE", "trial")
if access_mode not in {"trial", "public"}:
    raise RuntimeError("SOLO_ACCESS_MODE must be trial or public")
trial_password = os.environ.get("SOLO_TRIAL_PASSWORD", "").encode()
if access_mode == "trial" and len(trial_password) < 24:
    raise RuntimeError("Supply a random SOLO_TRIAL_PASSWORD of at least 24 bytes")


@app.before_request
def trial_gate():
    if access_mode == "public" or (request.endpoint == "health" and request.method in {"GET", "HEAD"}):
        return None
    credentials = request.authorization
    if credentials and credentials.type == "basic":
        user_ok = hmac.compare_digest((credentials.username or "").encode(), b"owner")
        password_ok = hmac.compare_digest((credentials.password or "").encode(), trial_password)
        if user_ok and password_ok:
            return None
    return Response("Authentication required.", status=401,
                    headers={"WWW-Authenticate": 'Basic realm="Doxera trial", charset="UTF-8"'})


@app.after_request
def headers(response):
    response.headers.update({"Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff",
        "Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; worker-src 'self'; img-src 'self' blob: data:; font-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})
    return response


@app.context_processor
def tool_limits():
    return {"limits": {slug: {"min": t.minimum, "max": t.maximum, "extensions": t.extensions}
                       for slug, t in TOOLS.items()}}


@app.get("/health")
def health():
    return {"status":"ok"}


@app.get("/")
def home():
    session.permanent = True
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return render_template("tools.html", tools=TOOLS, unavailable=UNAVAILABLE, coming_soon=COMING_SOON)


@app.get("/terms-and-privacy")
def terms_and_privacy():
    return render_template("terms_privacy.html")


@app.get("/tools/<slug>")
def tool_page(slug):
    if slug not in TOOLS:
        abort(404)
    session.permanent = True
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return render_template("tools.html", tool=TOOLS[slug], slug=slug, tools=TOOLS, unavailable=UNAVAILABLE, coming_soon=COMING_SOON)


@app.errorhandler(413)
def too_large(_):
    return render_template("tools.html", error="Each file must be 50 MB or smaller. Use at most 100 MB per request."), 413


def process(slug, folder, option, parameters=None):
    env = {"PATH":os.defpath + ":/usr/local/bin", "PYTHONPATH":"/app", "HOME":str(folder), "TMPDIR":str(folder),
           "LANG":"C.UTF-8", "OPENBLAS_NUM_THREADS":"1", "OMP_THREAD_LIMIT":"1", "PYTHONDONTWRITEBYTECODE":"1",
           "SOLO_PARENT_PID":str(os.getpid()), "HTML_CONVERSION_TIMEOUT_SECONDS":"70", "OFFICE_CONVERSION_TIMEOUT_SECONDS":"70"}
    # The converter never receives the signed session secret or an original file name.
    with subprocess.Popen([sys.executable,"-m","solo.process"], cwd=folder, env=env, stdin=subprocess.PIPE,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True) as child:
        try:
            child.communicate(json.dumps({"tool":slug,"option":option,"parameters":parameters}).encode(), timeout=90)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            if slug in {"compress-pdf", "batch-processing"}:
                logger.warning("compression level=%s reason=timeout", option or "medium")
            abort(422, "Conversion exceeded the time limit. Try a smaller file.")
        if slug in {"compress-pdf", "batch-processing"} and child.returncode in {3, 4}:
            reason = "no_size_reduction" if child.returncode == 3 else "pdf_rewrite_failed"
            logger.warning("compression level=%s engine=PyMuPDF reason=%s", option or "medium", reason)
            if child.returncode == 3:
                abort(422, "Compression could not make the PDF smaller at this level. Keep your original file or try High.")
            abort(422, "The PDF could not be rewritten. Your original file is unchanged.")
        if child.returncode == 5:
            message = folder / "input-error.txt"
            if message.is_file() and not message.is_symlink() and message.stat().st_size <= 1600:
                abort(422, message.read_text(encoding="utf-8"))
        if child.returncode:
            if slug == "compress-pdf":
                logger.warning("compression level=%s reason=worker_exit exit=%d", option, child.returncode)
            abort(422, "Conversion failed. Check the document type, page selection or password, or try a smaller file.")


@app.errorhandler(422)
@app.errorhandler(429)
@app.errorhandler(503)
@app.errorhandler(403)
def failed(error):
    return render_template("tools.html", error=error.description), error.code


def report_download(pdf, summary, slug):
    """Stream the report and its UI details in one response before temporary paths expire."""
    if summary.is_symlink() or not summary.is_file() or summary.stat().st_size > 4_000_000:
        abort(422, "The report could not be produced.")
    boundary = secrets.token_hex(24)
    details = summary.read_bytes()
    stream = pdf.open("rb")

    def parts():
        try:
            yield f'--{boundary}\r\nContent-Disposition: form-data; name="summary"\r\n\r\n'.encode()
            yield details
            yield f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{slug}.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
            yield from iter(lambda: stream.read(65536), b"")
            yield f'\r\n--{boundary}--\r\n'.encode()
        finally:
            stream.close()

    response = Response(parts(), content_type=f"multipart/form-data; boundary={boundary}")
    response.call_on_close(stream.close)
    return response


@app.post("/tools/<slug>")
def run_tool(slug):
    tool = TOOLS.get(slug)
    if not tool:
        abort(404)
    if slug == "sign-pdf":
        # The worker accepts up to 300 KB of decoded signature image. Allow for base64 framing.
        request.max_form_memory_size = 450_000
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
        option = "" if slug == "batch-processing" else request.form.get("option", "")
        parameters = None
        if "parameters" in request.form:
            try:
                parameters = json.loads(request.form["parameters"])
            except (ValueError, RecursionError):
                abort(422, "Invalid tool settings.")
            if not isinstance(parameters, dict) or len(parameters) > 30:
                abort(422, "Invalid tool settings.")
        if parameters is None and tool.prompt and (not option.strip() or len(option) > 500 or tool.choices and option not in tool.choices):
            abort(422, "Enter a valid tool setting.")
        if parameters is not None:
            # The richer controls still use the same allowlisted converter and bounded request.
            if tool.choices and option not in tool.choices:
                abort(422, "Choose a supported setting.")
            if len(option) > 500:
                abort(422, "This setting is too long.")
        with new_directory() as name:
            folder = Path(name)
            for i, upload in enumerate(uploads):
                extension = Path(upload.filename or "").suffix[1:].lower()
                if extension not in tool.extensions:
                    abort(422, "This file type is unsupported for the selected tool.")
                target = folder / f"input-{i}.{extension}"
                upload.save(target)
                upload.close()
            if slug == "compress-pdf":
                input_bytes = target.stat().st_size
            process(slug, folder, option, parameters)
            outputs = list(folder.glob("download.*"))
            if len(outputs) != 1 or outputs[0].is_symlink():
                abort(422, "No valid output was produced.")
            output = outputs[0]
            if parameters is not None and slug in {"compare-pdf", "sign-pdf"}:
                return report_download(output, folder / "summary.json", slug)
            stream = output.open("rb")
            try:
                response = send_file(stream, as_attachment=True, download_name=slug + output.suffix,
                                     conditional=False, etag=False)
                response.content_length = os.fstat(stream.fileno()).st_size
                if slug == "compress-pdf":
                    response.headers["X-Original-Bytes"] = str(input_bytes)
                    response.headers["X-Compression-Level"] = option
                    logger.info("compression level=%s engine=PyMuPDF before=%d after=%d",
                                option, input_bytes, response.content_length)
            except BaseException:
                stream.close()
                raise
        # On Linux the pathname is gone before streaming; WSGI closes the descriptor at EOF/disconnect.
        return response
