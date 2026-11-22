"""Validate the bytes of a private S3 upload without invoking a document converter."""
import hashlib
import hmac
import os
import struct
import zipfile
from contextlib import closing
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree

import olefile
import pymupdf
from PIL import Image

from app.processors.html_tools import check_html_input
from app.config import settings


OOXML = {
    "docx": ("word/document.xml", "wordprocessingml.document"),
    "xlsx": ("xl/workbook.xml", "spreadsheetml.sheet"),
    "pptx": ("ppt/presentation.xml", "presentationml.presentation"),
}
OLE = {"doc": ("WordDocument",), "xls": ("Workbook", "Book"), "ppt": ("PowerPoint Document",)}
IMAGE_FORMATS = {"png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP"}
MIME = {
    "pdf": "application/pdf", "html": "text/html", "htm": "text/html",
    "doc": "application/msword", "xls": "application/vnd.ms-excel", "ppt": "application/vnd.ms-powerpoint",
    **{ext: "image/" + fmt.lower() for ext, fmt in IMAGE_FORMATS.items()},
    **{ext: "application/vnd.openxmlformats-officedocument." + kind for ext, (_, kind) in OOXML.items()},
}


class InvalidUpload(ValueError):
    pass


def valid_office_package(path, ext):
    # Bound the central directory before zipfile materializes its entries.
    with open(path, "rb") as stream:
        stream.seek(max(0, os.path.getsize(path) - 65557))
        trailer = stream.read()
    offset = trailer.rfind(b"PK\x05\x06")
    if offset < 0 or len(trailer) - offset < 22:
        return False
    entries, directory_size = struct.unpack_from("<HI", trailer, offset + 10)
    if entries > 20000 or directory_size > 8 * 1024 * 1024:
        return False
    part, kind = OOXML[ext]
    with zipfile.ZipFile(path) as archive:
        if part not in archive.namelist():
            return False
        info = archive.getinfo("[Content_Types].xml")
        if info.file_size > 1024 * 1024:
            return False
        manifest = ElementTree.fromstring(archive.read(info))
        declared = any(node.get("PartName") == "/" + part and
                       node.get("ContentType") == "application/vnd.openxmlformats-officedocument." + kind + ".main+xml"
                       for node in manifest)
        if not declared or archive.getinfo(part).file_size > 256 * 1024 * 1024:
            return False
        family = kind.split(".")[0]
        element = {"docx": "document", "xlsx": "workbook", "pptx": "presentation"}[ext]
        with archive.open(part) as body:
            _, root = next(ElementTree.iterparse(body, events=("start",)))
        return root.tag in {
            "{http://schemas.openxmlformats.org/" + family + "/2006/main}" + element,
            "{http://purl.oclc.org/ooxml/" + family + "/main}" + element,
        }


def check_format(path, filename, mime):
    ext = Path(filename).suffix.lower().lstrip(".")
    if MIME.get(ext) != mime:
        raise InvalidUpload("Filename and content type disagree")
    try:
        if ext == "pdf":
            with pymupdf.open(path) as doc:
                valid = doc.is_pdf and doc.page_count > 0
        elif ext in IMAGE_FORMATS:
            with Image.open(path) as image:
                valid = image.format == IMAGE_FORMATS[ext]
                image.verify()
        elif ext in OOXML:
            valid = valid_office_package(path, ext)
        elif ext in OLE:
            with olefile.OleFileIO(path) as doc:
                valid = any(doc.exists(name) for name in OLE[ext])
        else:
            check_html_input(path)
            valid = True  # The HTML tool also accepts plain text and legacy encodings.
    except Exception as error:
        raise InvalidUpload("Unreadable or unsupported file content") from error
    if not valid:
        raise InvalidUpload("Stored content does not match the requested format")


def verify_object(client, bucket, key, filename, mime, size, checksum):
    from app.scratch import job_directory

    response = client.get_object(Bucket=bucket, Key=key)
    digest = hashlib.sha256()
    with closing(response["Body"]) as body, job_directory(settings.TMP_STORAGE_DIR, uuid4()) as directory:
        if response["ContentLength"] != size:
            raise InvalidUpload("Upload length mismatch")
        path = os.path.join(directory, "document")
        count = 0
        with open(path, "wb") as output:
            for chunk in body.iter_chunks(chunk_size=1024 * 1024):
                count += len(chunk)
                if count > size:
                    raise InvalidUpload("Upload length mismatch")
                digest.update(chunk)
                output.write(chunk)
        actual = digest.hexdigest()
        if count != size or (checksum and not hmac.compare_digest(checksum.lower(), actual)):
            raise InvalidUpload("Upload integrity check failed")
        check_format(path, filename, mime)
        # Copy the exact local snapshot that passed parsing. A client PUT URL can
        # still replace the staging object, including on some S3-compatible stores.
        client.upload_file(path, bucket, "uploads/verified/" + key.removeprefix("uploads/"),
                           ExtraArgs={"ContentType": mime})
        return {"sha256": actual, "uploadedAt": response["LastModified"].isoformat()}
