"""Run one conversion inside its request directory. stdin carries options, never argv."""
import base64
import csv
import ctypes
import errno
import json
import os
from pathlib import Path
import resource
import signal
import socket
import sys
import zipfile


def restrict_process():
    # Fail closed if the host cannot install the network filter. Subprocesses inherit it.
    lib = ctypes.CDLL("libseccomp.so.2")
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int,
                                          ctypes.c_uint, ctypes.c_void_p]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    class Filter(ctypes.Structure):
        _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_uint), ("value", ctypes.c_uint64), ("other", ctypes.c_uint64)]
    ctx = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not ctx:
        raise RuntimeError("Cannot initialize process limits")
    deny = 0x00050000 | errno.EPERM
    try:
        for name in ("socket", "socketpair", "io_uring_setup"):
            n = lib.seccomp_syscall_resolve_name(name.encode())
            if n < 0:
                raise RuntimeError("Unknown syscall")
            # SCMP_CMP_NE only permits Unix-domain IPC needed by LibreOffice.
            rule = Filter(0, 1, socket.AF_UNIX, 0)
            scoped = name != "io_uring_setup"
            if lib.seccomp_rule_add_array(ctx, deny, n, int(scoped), ctypes.byref(rule) if scoped else None):
                raise RuntimeError("Cannot define network limits")
        if lib.seccomp_load(ctx):
            raise RuntimeError("Cannot enable network limits")
    finally:
        lib.seccomp_release(ctx)
    resource.setrlimit(resource.RLIMIT_CPU, (80, 85))
    resource.setrlimit(resource.RLIMIT_FSIZE, (128_000_000, 128_000_000))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def bundle(paths, result):
    with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, Path(path).name)
    return result


def convert(tool, files, option, work):
    import pymupdf
    from PIL import Image
    from app.upload_verification import check_format, MIME, OOXML
    from app.processors import advanced_tools as advanced, basic_tools as basic, conversions as conv
    from app.processors import bates_tools, compare_tools, delete_tools, encrypt_tools, extract_tools
    from app.processors import redact_tools, reorder_tools, sign_tools, split_tools
    for file in files:
        ext = file.suffix[1:]
        if ext in OOXML:
            with zipfile.ZipFile(file) as archive:
                if sum(m.file_size for m in archive.infolist()) > 150_000_000:
                    raise ValueError("Office document too large when expanded")
        check_format(str(file), file.name, MIME[ext])
        if ext == "pdf":
            with pymupdf.open(file) as pdf:
                if len(pdf) > 150 or (pdf.needs_pass and tool != "unlock-pdf"):
                    raise ValueError("Use a smaller or unlocked document")
                if not pdf.needs_pass and any(p.rect.get_area() > 4_000_000 for p in pdf):
                    raise ValueError("Page dimensions too large")
        if ext in ("jpg","jpeg","png","webp"):
            with Image.open(file) as img:
                if img.width * img.height > 24_000_000:
                    raise ValueError("Image dimensions too large")
    first = str(files[0])
    paths = [str(p) for p in files]
    result = str(work / "result.pdf")
    if tool == "merge-pdf":
        basic.merge_pdfs(paths, result)
    elif tool == "compress-pdf":
        basic.compress_pdf(first, result, option)
    elif tool == "split-pdf":
        result = split_tools.split_pdf_by_mode(first, result, "every", {}, "document.pdf")
    elif tool == "rotate-pdf":
        basic.rotate_pdf(first, result, int(option))
    elif tool == "delete-pdf-pages":
        delete_tools.delete_pages_strict(first, result, option)
    elif tool == "extract-pdf-pages":
        result = extract_tools.extract_pages_by_mode(first, result, "single", {"pages": option}, "document.pdf")
    elif tool == "reorder-pages":
        reorder_tools.reorder_pages_strict(first, result, [int(i.strip()) for i in option.split(",")])
    elif tool == "pdf-to-word":
        result = str(work / "result.docx")
        conv.pdf_to_word(first, result)
    elif tool == "pdf-to-excel":
        from openpyxl import Workbook
        from openpyxl.cell import WriteOnlyCell
        raw = work / "table.csv"
        conv.pdf_to_excel(first, str(raw))
        book = Workbook(write_only=True)
        sheet = book.create_sheet("Extracted text")
        with raw.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.reader(stream):
                cells = []
                for value in row:
                    cell = WriteOnlyCell(sheet, value=value)
                    cell.data_type = "s"  # Document content is text, including leading equals signs.
                    cells.append(cell)
                sheet.append(cells)
        result = str(work / "result.xlsx")
        book.save(result)
    elif tool == "pdf-to-powerpoint":
        result = str(work / "result.pptx")
        conv.pdf_to_ppt(first, result, mode="visual")
    elif tool in ("word-to-pdf","excel-to-pdf","ppt-to-pdf"):
        result = conv.office_to_pdf(first, str(work))
    elif tool == "image-to-pdf":
        conv.images_to_pdf(paths, result)
        with pymupdf.open(result) as doc:
            if len(doc) != len(files):
                raise ValueError("An image could not be converted")
    elif tool == "pdf-to-image":
        images = conv.pdf_to_images(first, str(work))
        result = images[0] if len(images) == 1 else bundle(images, work / "pages.zip")
    elif tool == "html-to-pdf":
        from app.processors import html_tools
        # This process handles one job. Give the nested renderer our stricter file ceiling.
        html_tools.MAX_OUTPUT_BYTES = min(html_tools.MAX_OUTPUT_BYTES, resource.getrlimit(resource.RLIMIT_FSIZE)[1])
        conv.html_to_pdf(first, result)
    elif tool == "pdf-watermark":
        basic.add_watermark(first, result, text=option)
    elif tool in ("pdf-encryption","protect-pdf"):
        encrypt_tools.encrypt_pdf_strict(first, result, option)
    elif tool == "unlock-pdf":
        basic.decrypt_pdf(first, result, option)
    elif tool == "bates-numbering":
        result = bates_tools.apply_bates(paths, result, {"prefix": option})
    elif tool == "redact-pdf":
        redact_tools.redact_document(first, result, {"terms":[option]})
    elif tool == "sign-pdf":
        pdf, image = sorted(files, key=lambda f: f.suffix != ".pdf")
        if pdf.suffix != ".pdf" or image.suffix != ".png" or image.stat().st_size > 2_000_000:
            raise ValueError("Provide a PDF and a signature PNG")
        with pymupdf.open(pdf) as doc:
            width, height = doc[0].rect.width, doc[0].rect.height
        placement = dict(page=1, x=12, y=height-64, width=min(width-24,180), height=48)
        sign_tools.sign_document(str(pdf), result, {"signMode":"visual","placement":placement},
                                 {"signatureImage":"data:image/png;base64," + base64.b64encode(image.read_bytes()).decode("ascii")})
    elif tool == "compare-pdf":
        compare_tools.compare_pdfs(first, paths[1], result, timeout=70)
    elif tool == "pdf-metadata-editor":
        advanced.edit_metadata(first, result, title=option)
    elif tool == "pdf-repair":
        advanced.repair_pdf(first, result)
    elif tool == "ocr-pdf":
        advanced.ocr_pdf(first, result, option)
    elif tool == "batch-processing":
        outputs = []
        for index, source in enumerate(paths, 1):
            item = work / f"compressed-{index}.pdf"
            basic.compress_pdf(source, str(item))
            outputs.append(item)
        result = bundle(outputs, work / "compressed.zip")
    else:
        raise ValueError("Unsupported tool")
    path = Path(result).resolve()
    if path.parent != work or not path.is_file() or not 0 < path.stat().st_size <= 128_000_000:
        raise ValueError("Invalid output")
    path.rename(work / ("download" + path.suffix.lower()))


if __name__ == "__main__":
    # Terminate even if Gunicorn replaces the worker while its child is processing a request.
    if ctypes.CDLL(None).prctl(1, signal.SIGKILL, 0, 0, 0) or os.getppid() != int(os.environ["SOLO_PARENT_PID"]):
        sys.exit(1)
    restrict_process()
    work = Path.cwd()
    request = json.load(sys.stdin)
    convert(request["tool"], sorted(work.glob("input-*")), request["option"], work)
