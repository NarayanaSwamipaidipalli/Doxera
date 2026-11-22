"""Encrypt PDF: protects a PDF with a password using PyMuPDF (MuPDF's standard security handler).

- AES-256 (PDF 2.0 / ISO 32000-2 "V5 R6") is the default; AES-128 ("V4 R4") is offered for older readers.
- The same password opens the document and owns it, so whoever has the password keeps full access.
- The source file is only read. The result is re-opened and checked before it is accepted: it must need a
  password, refuse a wrong one, open with the right one, report the chosen encryption, and keep the original
  page count, page sizes, text and images.
- The password is never logged, stored or put in an error message.
"""
from __future__ import annotations

import hashlib
import secrets
import unicodedata
from typing import List, Optional, Tuple

import pymupdf

from .split_tools import UserFacingError

METHODS = {
    "aes-256": (pymupdf.PDF_ENCRYPT_AES_256, "Standard V5 R6 256-bit AES"),
    "aes-128": (pymupdf.PDF_ENCRYPT_AES_128, "Standard V4 R4 128-bit AES"),
}
DEFAULT_METHOD = "aes-256"
MIN_LENGTH = 8
MAX_LENGTH = 40  # PyMuPDF refuses longer passwords ("password length must not exceed 40")
MAX_AES256_BYTES = 127  # PDF 2.0 uses at most the first 127 bytes of the UTF-8 password
MAX_AES128_CHARS = 32  # older handlers use at most 32 bytes, and only reliably for basic Latin text
PERMISSIONS = int(
    pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ | pymupdf.PDF_PERM_COPY
    | pymupdf.PDF_PERM_ANNOTATE | pymupdf.PDF_PERM_FORM | pymupdf.PDF_PERM_ACCESSIBILITY
)


def password_problem(password: object, method: str = DEFAULT_METHOD) -> Optional[str]:
    """Structural checks the worker always applies (the API also enforces the full password policy)."""
    if not isinstance(password, str) or not password.strip():
        return "Enter a password to protect the PDF."
    if len(password) < MIN_LENGTH:
        return f"Use a password of at least {MIN_LENGTH} characters."
    if any(unicodedata.category(ch) in ("Cc", "Cf", "Cs", "Co") for ch in password):
        return "Passwords can't contain control or invisible characters."
    if len(password) > MAX_LENGTH:
        return f"Use a password of at most {MAX_LENGTH} characters."
    if method == "aes-128":
        if not all(" " <= ch <= "~" for ch in password):
            return "AES-128 passwords can only use basic Latin letters, digits, spaces and symbols. Choose AES-256 for other characters."
        if len(password) > MAX_AES128_CHARS:
            return f"AES-128 passwords can be at most {MAX_AES128_CHARS} characters. Choose AES-256 for longer passwords."
    elif len(password.encode("utf-8")) > MAX_AES256_BYTES:
        return "This password is too long for PDF encryption. Use fewer characters."
    return None


def _snapshot(doc: "pymupdf.Document") -> List[Tuple[float, float, str, int]]:
    """Per page: size, a digest of the text, and the number of images."""
    pages = []
    for page in doc:
        text = hashlib.sha256(page.get_text("text").encode("utf-8")).hexdigest()
        pages.append((round(page.rect.width, 2), round(page.rect.height, 2), text, len(page.get_images(full=False))))
    return pages


def _open_source(input_path: str) -> "pymupdf.Document":
    try:
        doc = pymupdf.open(input_path)
    except Exception:
        raise UserFacingError("This file could not be read as a PDF. It may be damaged.") from None
    if not doc.is_pdf:
        doc.close()
        raise UserFacingError("This file is not a PDF document.")
    if doc.needs_pass:
        doc.close()
        raise UserFacingError("This PDF is already password-protected. Remove its password with Unlock PDF, then encrypt it again.")
    if (doc.metadata or {}).get("encryption"):
        doc.close()
        raise UserFacingError("This PDF is already encrypted (it has restrictions set by its owner). Remove them with Unlock PDF, then encrypt it again.")
    if doc.page_count == 0:
        doc.close()
        raise UserFacingError("This PDF has no pages.")
    return doc


def _verify(output_path: str, password: str, label: str, expected: list) -> None:
    try:
        check = pymupdf.open(output_path)
    except Exception:
        raise UserFacingError("Encryption failed: the protected PDF could not be read back. Please try again.") from None
    try:
        problems = []
        if not check.needs_pass:
            problems.append("opens without a password")
        if check.authenticate(secrets.token_urlsafe(18)):
            problems.append("opens with a wrong password")
        if not check.authenticate(password):
            problems.append("does not open with the password")
        else:
            if (check.metadata or {}).get("encryption") != label:
                problems.append("unexpected encryption")
            if _snapshot(check) != expected:
                problems.append("content differs from the original")
    finally:
        check.close()
    if problems:
        raise UserFacingError("Encryption failed: the protected PDF did not pass its checks. Please try again.")


def encrypt_pdf_strict(input_path: str, output_path: str, password: object, method: object = DEFAULT_METHOD) -> dict:
    """Writes an encrypted copy of `input_path` to `output_path` and verifies it. Returns what was applied."""
    method = DEFAULT_METHOD if method in (None, "") else method
    if method not in METHODS:
        raise UserFacingError("Choose an encryption strength: AES-256 or AES-128.")
    problem = password_problem(password, method)
    if problem:
        raise UserFacingError(problem)
    code, label = METHODS[method]
    doc = _open_source(input_path)
    try:
        expected = _snapshot(doc)
        # garbage=1 only drops unused objects; merging duplicates (3+) is not needed to encrypt.
        doc.save(output_path, encryption=code, user_pw=password, owner_pw=password,
                 permissions=PERMISSIONS, garbage=1, deflate=True)
    finally:
        doc.close()
    _verify(output_path, password, label, expected)
    return {"pages": len(expected), "encryption": label}
