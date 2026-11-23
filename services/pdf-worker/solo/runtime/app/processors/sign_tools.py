"""Sign PDF, in two deliberately separate modes.

``visual``
    Places a signature *appearance* on a page: a drawn, typed or uploaded signature image with optional name and
    date lines. This is an electronic signature image. It does not identify the signer cryptographically and does
    not detect later changes, and the report says so.

``certificate``
    A PDF digital signature made with the user's PKCS#12 (.pfx/.p12) certificate through pyHanko. It is an
    ISO 32000 signature field holding a detached CMS signature in PAdES form, SHA-256, over the /ByteRange. It is
    appended as an incremental update, so the original bytes, and any earlier signatures, stay unchanged. The
    result is checked before it is offered: the /ByteRange layout, the CMS message digest (recomputed here), the
    signature value, and whole-file coverage must all pass. Trust, revocation and timestamp status are reported
    separately; they are never folded into a single "verified".

Secrets arrive sealed (app.job_secrets): the signature image, the PKCS#12 file and its password. They are held
only in memory here, never written to disk, logged or put in an error message.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import logging
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone

import pymupdf
from PIL import Image

from app.config import settings
from app.processors.split_tools import UserFacingError

logger = logging.getLogger(__name__)
# pyHanko logs a full traceback (with the certificate subject) for every untrusted chain; that is expected for
# self-signed certificates and is reported to the user instead.
for _name in ("pyhanko", "pyhanko_certvalidator"):
    logging.getLogger(_name).setLevel(logging.CRITICAL)

MODES = ("visual", "certificate")
MAX_IMAGE_BYTES = 300_000          # decoded signature image
MAX_IMAGE_SIDE = 2400
MAX_PFX_BYTES = 50_000
MIN_BOX_WIDTH, MIN_BOX_HEIGHT = 36.0, 18.0
MAX_TEXT = 120
_FONT_FILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


# ----------------------------------------------------------------------------------------------- helpers

def _text(value, limit=MAX_TEXT) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise UserFacingError("Signature details must be text.")
    value = _CONTROL.sub(" ", value).strip()
    if len(value) > limit:
        raise UserFacingError(f"Signature details can be at most {limit} characters.")
    return value


def _number(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value in (float("inf"), float("-inf")):
        raise UserFacingError("The signature position is not valid. Place the signature on the page again.")
    return float(value)


@dataclass(frozen=True)
class Placement:
    page_index: int
    rect: pymupdf.Rect          # displayed (rotated) page coordinates, top-left origin, points


def _placement(parameters: dict, page_count: int, required: bool) -> Placement | None:
    raw = parameters.get("placement")
    if raw is None:
        if required:
            raise UserFacingError("Choose where the signature goes on the page.")
        return None
    if not isinstance(raw, dict):
        raise UserFacingError("The signature position is not valid. Place the signature on the page again.")
    page = raw.get("page")
    if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= page_count:
        raise UserFacingError(f"The signature page must be between 1 and {page_count}.")
    x, y, w, h = (_number(raw.get(k)) for k in ("x", "y", "width", "height"))
    if w < MIN_BOX_WIDTH or h < MIN_BOX_HEIGHT:
        raise UserFacingError("The signature box is too small. Make it at least 36 × 18 points.")
    return Placement(page - 1, pymupdf.Rect(x, y, x + w, y + h))


def _check_on_page(page, rect: pymupdf.Rect) -> None:
    bounds = page.rect  # displayed size, origin at the top-left of the visible area
    if rect.x0 < -0.5 or rect.y0 < -0.5 or rect.x1 > bounds.width + 0.5 or rect.y1 > bounds.height + 0.5:
        raise UserFacingError("The signature box goes past the edge of the page. Move it fully onto the page.")


def _inherited_box(doc, page, key: str):
    """A page box (/CropBox or /MediaBox) in PDF user space, following /Parent inheritance."""
    xref = page.xref
    for _ in range(64):
        kind, value = doc.xref_get_key(xref, key)
        if kind == "xref":
            value, kind = doc.xref_object(int(value.split()[0]), compressed=True), "array"
        if kind == "array":
            numbers = [float(v) for v in value.strip().strip("[]").split()]
            if len(numbers) == 4:
                x0, y0, x1, y1 = numbers
                return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)
        kind, parent = doc.xref_get_key(xref, "Parent")
        if kind != "xref":
            return None
        xref = int(parent.split()[0])
    return None


def _visible_box(doc, page) -> tuple[float, float, float, float]:
    """The CropBox clipped to the MediaBox (what viewers show), in PDF user space."""
    media = _inherited_box(doc, page, "MediaBox") or (0.0, 0.0, 612.0, 792.0)
    crop = _inherited_box(doc, page, "CropBox") or media
    box = (max(crop[0], media[0]), max(crop[1], media[1]), min(crop[2], media[2]), min(crop[3], media[3]))
    return box if box[2] > box[0] and box[3] > box[1] else media


def _displayed_to_pdf(rect: pymupdf.Rect, visible, rotation: int) -> tuple[float, float, float, float]:
    """Maps a rectangle on the page as displayed (rotated, top-left origin, as in the preview) to PDF user space.

    Done explicitly from the visible box and /Rotate (as pdf.js and Acrobat do) rather than through PyMuPDF's
    matrices, which disagree with its renderer on pages that are both cropped and rotated.
    """
    cx0, cy0, cx1, cy1 = visible
    width, height = cx1 - cx0, cy1 - cy0

    def unrotate(dx: float, dy: float) -> tuple[float, float]:
        if rotation == 90:
            ux, uy = dy, height - dx
        elif rotation == 180:
            ux, uy = width - dx, height - dy
        elif rotation == 270:
            ux, uy = width - dy, dx
        else:
            ux, uy = dx, dy
        return cx0 + ux, cy1 - uy

    xa, ya = unrotate(rect.x0, rect.y0)
    xb, yb = unrotate(rect.x1, rect.y1)
    return tuple(round(v, 2) for v in (min(xa, xb), min(ya, yb), max(xa, xb), max(ya, yb)))


def _to_mupdf(page, visible, rect: pymupdf.Rect) -> pymupdf.Rect:
    """Displayed rectangle -> the unrotated coordinates PyMuPDF's drawing calls expect (via PDF user space)."""
    x0, y0, x1, y1 = _displayed_to_pdf(rect, visible, page.rotation)
    if x0 == x1 and y0 == y1:
        return pymupdf.Rect(pymupdf.Point(x0, y0) * page.transformation_matrix, pymupdf.Point(x0, y0) * page.transformation_matrix)
    mapped = pymupdf.Rect(x0, y0, x1, y1) * page.transformation_matrix
    mapped.normalize()
    return mapped


def _existing_signature_count(original: bytes) -> tuple[int, object | None]:
    """(number of signed signature fields, pyHanko reader or None when pyHanko cannot parse the file)."""
    from pyhanko.pdf_utils.reader import PdfFileReader

    try:
        reader = PdfFileReader(io.BytesIO(original), strict=False)
        if reader.encrypted:
            raise UserFacingError("This PDF is password-protected. Remove the password with Unlock PDF first.")
        signatures = reader.embedded_signatures
        for signature in signatures:
            level = signature.docmdp_level
            if level is not None and getattr(level, "value", level) == 1:
                raise UserFacingError(
                    "This PDF is certified with “no changes allowed”. Adding a signature would invalidate the certification.")
        return len(signatures), reader
    except UserFacingError:
        raise
    except Exception:
        return -1, None


def _open_pdf(path: str):
    try:
        doc = pymupdf.open(path)
    except Exception:
        raise UserFacingError("This file could not be opened as a PDF. It may be damaged.") from None
    if doc.needs_pass or doc.is_encrypted:
        doc.close()
        raise UserFacingError("This PDF is password-protected. Remove the password with Unlock PDF first.")
    if doc.page_count == 0:
        doc.close()
        raise UserFacingError("This PDF has no pages.")
    return doc


def _page_snapshot(doc) -> list[tuple[str, tuple]]:
    return [(page.get_text("text"), tuple(round(v, 2) for v in page.rect)) for page in doc]


def _content_snapshot(doc) -> list[tuple[str, tuple, int]]:
    """Each page's content stream digest, size and rotation (widget text is not part of the page content)."""
    return [(hashlib.sha256(page.read_contents()).hexdigest(), tuple(round(v, 2) for v in page.rect), page.rotation)
            for page in doc]


def _require_acknowledged(count: int, parameters: dict) -> None:
    if count > 0 and parameters.get("acknowledgeExistingSignatures") is not True:
        noun = "signature" if count == 1 else "signatures"
        raise UserFacingError(
            f"This PDF already has {count} digital {noun}. Confirm that you want to add another; "
            "the earlier signatures are kept, but readers will show that the document changed after they were made.")


def sign_document(input_path: str, output_path: str, parameters: dict, secrets: dict) -> dict:
    """Signs input_path into output_path and returns the (non-secret) verification report."""
    mode = parameters.get("signMode")
    if mode not in MODES:
        raise UserFacingError("Choose a signing mode: visual signature or certificate-based digital signature.")
    if mode == "visual":
        return visual_sign(input_path, output_path, parameters, secrets.get("signatureImage"))
    return certificate_sign(input_path, output_path, parameters,
                            secrets.get("certificate"), secrets.get("certificatePassword"))


# ----------------------------------------------------------------------------------------------- visual mode

def _decode_signature_image(data_url) -> bytes:
    if not isinstance(data_url, str) or not data_url:
        raise UserFacingError("Draw, type or upload a signature first.")
    match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)", data_url)
    if not match:
        raise UserFacingError("The signature image must be a PNG or JPEG.")
    try:
        raw = base64.b64decode(match.group(2), validate=False)
    except (binascii.Error, ValueError):
        raise UserFacingError("The signature image could not be read.") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise UserFacingError("The signature image is too large. Use an image under 300 KB.")
    formats = (match.group(1).upper(),)
    try:
        with Image.open(io.BytesIO(raw), formats=formats) as probe:
            if max(probe.size) > MAX_IMAGE_SIDE:
                raise UserFacingError("The signature image is too large. Use one at most 2400 pixels wide.")
            probe.verify()
        with Image.open(io.BytesIO(raw), formats=formats) as image:
            image = image.convert("RGBA")
    except UserFacingError:
        raise
    except Exception:
        raise UserFacingError("The signature image could not be read.") from None
    box = image.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if box is None:
        raise UserFacingError("The signature is empty. Draw, type or upload a signature first.")
    image = image.crop(box)
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)  # re-encoded: no metadata from the original file is kept
    return out.getvalue()


def _fit_line(text: str, width: float, size: float, fontfile: str | None) -> tuple[str, float]:
    font = pymupdf.Font(fontfile=fontfile) if fontfile else pymupdf.Font("helv")
    while size > 5 and font.text_length(text, fontsize=size) > width:
        size -= 0.5
    while text and font.text_length(text + "...", fontsize=size) > width and font.text_length(text, fontsize=size) > width:
        text = text[:-1]
    if font.text_length(text, fontsize=size) > width:
        text = text.rstrip() + "..."
    return text, size


def visual_sign(input_path: str, output_path: str, parameters: dict, signature_image) -> dict:
    png = _decode_signature_image(signature_image)
    name = _text(parameters.get("signerName"), 80) if parameters.get("showName") else ""
    date = _text(parameters.get("dateText"), 40) if parameters.get("showDate") else ""

    with open(input_path, "rb") as handle:
        original = handle.read()
    existing, _ = _existing_signature_count(original)
    doc = _open_pdf(input_path)
    try:
        if existing < 0:
            existing = 1 if doc.get_sigflags() >= 1 else 0
        _require_acknowledged(existing, parameters)
        placement = _placement(parameters, doc.page_count, required=True)
        before = _page_snapshot(doc)
        page_count = doc.page_count
    finally:
        doc.close()

    incremental = existing > 0
    if incremental:
        # Earlier signatures cover the original bytes; append instead of rewriting so they stay valid.
        shutil.copyfile(input_path, output_path)
        doc = pymupdf.open(output_path)
        if not doc.can_save_incrementally():
            doc.close()
            raise UserFacingError("This signed PDF can't be updated without breaking its signatures.")
    else:
        doc = pymupdf.open(input_path)
    try:
        page = doc[placement.page_index]
        _check_on_page(page, placement.rect)
        box = placement.rect
        fontfile = _FONT_FILE if os.path.exists(_FONT_FILE) else None
        fontname = "dejavu" if fontfile else "helv"
        lines = [line for line in (name, date) if line]
        size = max(6.0, min(10.0, box.height * 0.13))
        text_height = len(lines) * size * 1.3
        image_box = pymupdf.Rect(box.x0, box.y0, box.x1, box.y1 - text_height - (2 if lines else 0))
        if image_box.height < 10:
            raise UserFacingError("Make the signature box taller so the name and date fit below the signature.")
        visible = _visible_box(doc, page)
        page.insert_image(_to_mupdf(page, visible, image_box), stream=png, keep_proportion=True,
                          rotate=page.rotation, overlay=True)
        baseline = image_box.y1 + 2
        for line in lines:
            fitted, line_size = _fit_line(line, box.width - 4, size, fontfile)
            baseline += line_size * 1.3
            anchor = pymupdf.Point(box.x0 + 2, baseline - line_size * 0.3)
            point = _to_mupdf(page, visible, pymupdf.Rect(anchor, anchor)).tl
            page.insert_text(point, fitted, fontsize=line_size, fontname=fontname, fontfile=fontfile,
                             color=(0.15, 0.17, 0.22), rotate=page.rotation)
        if incremental:
            doc.saveIncr()
        else:
            doc.save(output_path, garbage=3, deflate=True)
    finally:
        doc.close()

    _verify_visual(original, output_path, before, page_count, placement, incremental)
    return {
        "mode": "visual",
        "kind": "Visual signature appearance (not a certificate-based digital signature)",
        "page": placement.page_index + 1,
        "existingSignatures": existing,
        "originalPreserved": incremental,
        "cryptographicSignature": False,
    }


def _verify_visual(original: bytes, output_path: str, before, page_count: int, placement: Placement, incremental: bool):
    with open(output_path, "rb") as handle:
        signed = handle.read()
    if incremental and not signed.startswith(original):
        raise RuntimeError("signed revision was rewritten")
    doc = pymupdf.open(output_path)
    try:
        if doc.page_count != page_count:
            raise RuntimeError("page count changed")
        after = _page_snapshot(doc)
        for index, ((text_before, rect_before), (text_after, rect_after)) in enumerate(zip(before, after)):
            if rect_before != rect_after:
                raise RuntimeError("page size changed")
            if index != placement.page_index and text_before != text_after:
                raise RuntimeError("other page changed")
            if index == placement.page_index and not text_after.startswith(text_before.rstrip("\n")[:200]):
                raise RuntimeError("page text changed")
        page = doc[placement.page_index]
        pix = page.get_pixmap(alpha=False)  # rendered as displayed (rotation applied)
        r = placement.rect
        inked = any(min(pix.pixel(x, y)) < 200
                    for y in range(max(0, int(r.y0)), min(pix.height, int(r.y1)))
                    for x in range(max(0, int(r.x0)), min(pix.width, int(r.x1)), 2))
        if not inked:
            raise RuntimeError("signature not visible")
    finally:
        doc.close()


# ----------------------------------------------------------------------------------------------- certificate mode

@dataclass
class LoadedCertificate:
    key: object
    cert: object
    chain: list


def _load_pkcs12(encoded, password) -> LoadedCertificate:
    from asn1crypto import pkcs12 as asn1_pkcs12
    from cryptography import x509
    from cryptography.exceptions import UnsupportedAlgorithm
    from cryptography.hazmat.primitives.asymmetric import ec, rsa
    from cryptography.hazmat.primitives.serialization import pkcs12

    if not isinstance(encoded, str) or not encoded:
        raise UserFacingError("Upload your signing certificate (.pfx or .p12).")
    if password is not None and not isinstance(password, str):
        raise UserFacingError("Enter the certificate password.")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise UserFacingError("The certificate file could not be read. Upload a .pfx or .p12 file.") from None
    if len(data) > MAX_PFX_BYTES:
        raise UserFacingError("The certificate file is too large (over 50 KB). Export only the signing certificate, its key and chain.")
    try:
        parsed = asn1_pkcs12.Pfx.load(data, strict=True)  # strict: no trailing data
        if parsed["auth_safe"]["content_type"].native not in ("data", "signed_data"):
            raise ValueError("unexpected content")
    except Exception:
        raise UserFacingError("This is not a valid PKCS#12 certificate file. Upload a .pfx or .p12 file.") from None

    candidates = [password.encode("utf-8")] if password else [None, b""]
    loaded = None
    for candidate in candidates:
        try:
            loaded = pkcs12.load_key_and_certificates(data, candidate)
            break
        except UnsupportedAlgorithm:
            raise UserFacingError(
                "This certificate file uses an encryption method Doxera doesn't support (for example RC2). "
                "Export it again with AES-256 encryption.") from None
        except (ValueError, TypeError):
            continue
    if loaded is None:
        raise UserFacingError("The certificate password is incorrect.")
    key, cert, extra = loaded
    if key is None or cert is None:
        raise UserFacingError("The certificate file must contain both the signing certificate and its private key.")
    if isinstance(key, rsa.RSAPrivateKey):
        if key.key_size < 2048:
            raise UserFacingError("RSA keys must be at least 2048 bits.")
    elif isinstance(key, ec.EllipticCurvePrivateKey):
        if key.curve.name not in ("secp256r1", "secp384r1", "secp521r1"):
            raise UserFacingError("Only ECDSA keys on P-256, P-384 or P-521 are supported.")
    else:
        raise UserFacingError("Only RSA and ECDSA signing keys are supported.")
    if cert.public_key().public_numbers() != key.public_key().public_numbers():
        raise UserFacingError("The private key in this file does not belong to its certificate.")
    now = datetime.now(timezone.utc)
    if now > cert.not_valid_after_utc:
        raise UserFacingError(f"This certificate expired on {cert.not_valid_after_utc:%Y-%m-%d}. Use a valid certificate.")
    if now < cert.not_valid_before_utc:
        raise UserFacingError(f"This certificate is not valid until {cert.not_valid_before_utc:%Y-%m-%d}.")
    try:
        usage = cert.extensions.get_extension_for_class(x509.KeyUsage).value
        if not (usage.digital_signature or usage.content_commitment):
            raise UserFacingError("This certificate is not allowed to make digital signatures (its key usage forbids it).")
    except x509.ExtensionNotFound:
        pass
    return LoadedCertificate(key=key, cert=cert, chain=list(extra or []))


def _common_name(name) -> str:
    from cryptography.x509.oid import NameOID

    values = name.get_attributes_for_oid(NameOID.COMMON_NAME)
    if values:
        return str(values[0].value)
    return name.rfc4514_string()[:120] or "Unknown"


def _is_self_signed(cert) -> bool:
    if cert.issuer != cert.subject:
        return False
    try:
        cert.verify_directly_issued_by(cert)
        return True
    except Exception:
        return False


def _trust_roots() -> list:
    from asn1crypto import pem, x509 as asn1_x509

    path = settings.SIGNING_TRUST_ROOTS_FILE
    if not path:
        return []
    with open(path, "rb") as handle:
        data = handle.read()
    return [asn1_x509.Certificate.load(der) for _, _, der in pem.unarmor(data, multiple=True)]


def _timestamper():
    """The operator-configured RFC 3161 timestamp authority (never a user-supplied URL)."""
    from pyhanko.sign.timestamps import HTTPTimeStamper

    return HTTPTimeStamper(settings.SIGNING_TSA_URL, timeout=settings.SIGNING_TSA_TIMEOUT_SECONDS)


def _latin(text: str) -> str:
    return text.encode("latin-1", "replace").decode("latin-1")


def _stamp_background():
    """A light fill behind the stamp text so it stays readable over page content."""
    from pyhanko.pdf_utils import layout
    from pyhanko.pdf_utils.content import RawContent

    return RawContent(b"0.96 0.97 1 rg 0 0 100 100 re f", box=layout.BoxConstraints(width=100, height=100))


def _stamp_style(page_rotation: int, reason: str, location: str):
    from pyhanko.pdf_utils import generic, layout
    from pyhanko.pdf_utils.font.basic import SimpleFontEngineFactory
    from pyhanko.pdf_utils.text import TextBoxStyle
    from pyhanko.stamp import TextStamp, TextStampStyle

    class UprightTextStamp(TextStamp):
        def as_form_xobject(self):
            xobj = super().as_form_xobject()
            matrix = {90: (0, 1, -1, 0), 180: (-1, 0, 0, -1), 270: (0, -1, 1, 0)}.get(self.style.page_rotation)
            if matrix:
                # Readers map the rotated BBox onto the widget rectangle, so the stamp reads upright on screen.
                xobj["/Matrix"] = generic.ArrayObject([generic.NumberObject(v) for v in matrix]
                                                      + [generic.NumberObject(0), generic.NumberObject(0)])
            return xobj

    @dataclass(frozen=True)
    class UprightTextStampStyle(TextStampStyle):
        page_rotation: int = 0

        def create_stamp(self, writer, box, text_params):
            if self.page_rotation in (90, 270):
                box = layout.BoxConstraints(width=box.height, height=box.width)
            return UprightTextStamp(writer=writer, style=self, box=box, text_params=text_params)

    escape = lambda value: _latin(value).replace("%", "%%")
    lines = ["Digitally signed by %(signer)s", "Date: %(ts)s"]
    if reason:
        lines.append("Reason: " + escape(reason))
    if location:
        lines.append("Location: " + escape(location))
    return UprightTextStampStyle(
        page_rotation=page_rotation,
        stamp_text="\n".join(lines),
        timestamp_format="%Y-%m-%d %H:%M:%S UTC",
        border_width=1,
        border_color=(0.2, 0.35, 0.7),
        background=_stamp_background(),
        background_opacity=0.9,
        background_layout=layout.SimpleBoxLayoutRule(
            x_align=layout.AxisAlignment.ALIGN_MID, y_align=layout.AxisAlignment.ALIGN_MID,
            inner_content_scaling=layout.InnerScaling.STRETCH_FILL),
        text_box_style=TextBoxStyle(font=SimpleFontEngineFactory("Helvetica", 0.5), font_size=9),
        inner_content_layout=layout.SimpleBoxLayoutRule(
            x_align=layout.AxisAlignment.ALIGN_MIN, y_align=layout.AxisAlignment.ALIGN_MID,
            margins=layout.Margins.uniform(4), inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT),
    )


def certificate_sign(input_path: str, output_path: str, parameters: dict, certificate, password) -> dict:
    from asn1crypto import x509 as asn1_x509, keys as asn1_keys
    from cryptography.hazmat.primitives import serialization
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers
    from pyhanko.sign.general import SigningError
    from pyhanko_certvalidator.registry import SimpleCertificateStore

    reason = _text(parameters.get("reason"))
    location = _text(parameters.get("location"), 80)
    want_timestamp = parameters.get("timestamp") is True
    if want_timestamp and not settings.SIGNING_TSA_URL:
        raise UserFacingError("Trusted timestamps aren't available on this server. Sign without a timestamp.")

    loaded = _load_pkcs12(certificate, password)

    with open(input_path, "rb") as handle:
        original = handle.read()
    existing, reader = _existing_signature_count(original)
    doc = _open_pdf(input_path)
    try:
        rewritten = False
        if reader is None:
            if doc.get_sigflags() >= 1:
                raise UserFacingError("This signed PDF is damaged and can't be signed again without breaking its signatures.")
            # pyHanko could not parse the file structure; rewrite it cleanly first (it has no signatures to keep).
            original = doc.tobytes(garbage=3, deflate=True)
            rewritten = True
            existing, reader = _existing_signature_count(original)
            if reader is None:
                raise UserFacingError("This PDF is damaged and can't be signed. Try Repair PDF first.")
        _require_acknowledged(existing, parameters)
        placement = _placement(parameters, doc.page_count, required=False)
        page_count = doc.page_count
        before = _content_snapshot(doc)
        box = None
        rotation = 0
        if placement is not None:
            page = doc[placement.page_index]
            _check_on_page(page, placement.rect)
            rotation = page.rotation
            box = _displayed_to_pdf(placement.rect, _visible_box(doc, page), rotation)
    finally:
        doc.close()

    taken = set()
    try:
        for name, _, _ in fields.enumerate_sig_fields(reader):
            taken.add(name)
    except Exception:
        pass
    field_name = next(f"Signature{n}" for n in range(1, 1000) if f"Signature{n}" not in taken)

    signing_cert = asn1_x509.Certificate.load(loaded.cert.public_bytes(serialization.Encoding.DER))
    chain = [asn1_x509.Certificate.load(c.public_bytes(serialization.Encoding.DER)) for c in loaded.chain]
    key_info = asn1_keys.PrivateKeyInfo.load(loaded.key.private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    signer = signers.SimpleSigner(signing_cert=signing_cert, signing_key=key_info,
                                  cert_registry=SimpleCertificateStore.from_certs([signing_cert] + chain))
    del key_info, loaded.key

    meta = signers.PdfSignatureMetadata(
        field_name=field_name, md_algorithm="sha256", subfilter=fields.SigSeedSubFilter.PADES,
        reason=_latin(reason) or None, location=_latin(location) or None)
    spec = fields.SigFieldSpec(field_name, on_page=placement.page_index if placement else 0, box=box)
    timestamper = _timestamper() if want_timestamp else None
    output = io.BytesIO()
    try:
        writer = IncrementalPdfFileWriter(io.BytesIO(original), strict=False)
        signers.PdfSigner(meta, signer, timestamper=timestamper, stamp_style=_stamp_style(rotation, reason, location),
                          new_field_spec=spec).sign_pdf(
            writer, output=output,
            # The stamp font is Latin-1; characters outside it show as "?" instead of failing the signature.
            appearance_text_params={"signer": _latin(_common_name(loaded.cert.subject))})
    except UserFacingError:
        raise
    except Exception as exc:
        if want_timestamp and "timestamp" in type(exc).__name__.lower() + str(exc).lower():
            raise UserFacingError("The timestamp authority could not be reached. Try again, or sign without a trusted timestamp.") from None
        if isinstance(exc, SigningError):
            raise UserFacingError("This PDF could not be signed with this certificate.") from None
        raise
    finally:
        signer = None
    signed = output.getvalue()
    with open(output_path, "wb") as handle:
        handle.write(signed)

    report = verify_certificate_signature(original, signed, field_name, timestamped=want_timestamp)
    _check_pages_preserved(output_path, before, page_count)
    report.update({
        "mode": "certificate",
        "visible": placement is not None,
        "page": placement.page_index + 1 if placement else None,
        "existingSignatures": existing,
        "originalPreserved": not rewritten,
        "rewrittenBeforeSigning": rewritten,
    })
    return report


def _check_pages_preserved(output_path: str, before, page_count: int) -> None:
    doc = pymupdf.open(output_path)
    try:
        if doc.page_count != page_count or _content_snapshot(doc) != before:
            raise RuntimeError("signing changed the page content")
    finally:
        doc.close()


def cms_from_contents(hex_value: bytes):
    """The CMS ContentInfo in a /Contents hex string.

    /Contents is zero-padded after the DER object; a non-strict load reads exactly that one object. The zeros must
    never be stripped instead: a genuine signature can itself end in 0x00.
    """
    from asn1crypto import cms

    return cms.ContentInfo.load(bytes.fromhex(hex_value.decode("ascii")), strict=False)


class SignatureCheckFailed(RuntimeError):
    """The produced signature did not pass verification; the file must not be offered."""


def verify_certificate_signature(original: bytes, signed: bytes, field_name: str, timestamped: bool = False,
                                 trust_roots: list | None = None) -> dict:
    """Independent structural checks plus pyHanko validation. Raises SignatureCheckFailed on any integrity failure."""
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko.sign.validation.status import SignatureCoverageLevel
    from pyhanko_certvalidator import ValidationContext

    if original and not signed.startswith(original):
        raise SignatureCheckFailed("the original revision was not preserved")
    reader = PdfFileReader(io.BytesIO(signed), strict=False)
    matches = [s for s in reader.embedded_signatures if s.field_name == field_name]
    if len(matches) != 1:
        raise SignatureCheckFailed("signature field missing")
    sig = matches[0]
    if sig.sig_object.get("/Type") not in (None, "/Sig") or sig.sig_object.get("/Filter") != "/Adobe.PPKLite":
        raise SignatureCheckFailed("unexpected signature dictionary")

    # /ByteRange must be [0 a b c] covering the whole file except exactly the hex-encoded /Contents value.
    byte_range = [int(v) for v in sig.sig_object["/ByteRange"]]
    if len(byte_range) != 4:
        raise SignatureCheckFailed("bad ByteRange")
    start, first_len, second_start, second_len = byte_range
    if start != 0 or first_len <= 0 or second_start <= first_len or second_start + second_len != len(signed):
        raise SignatureCheckFailed("ByteRange does not cover the file")
    gap = signed[first_len:second_start]
    if not (gap.startswith(b"<") and gap.endswith(b">")) or not re.fullmatch(rb"[0-9A-Fa-f]*", gap[1:-1]):
        raise SignatureCheckFailed("ByteRange gap is not the signature value")
    # CMS: one SignerInfo, SHA-256, and a message digest equal to SHA-256 of the signed byte ranges (recomputed here).
    content = cms_from_contents(gap[1:-1])
    if content["content_type"].native != "signed_data":
        raise SignatureCheckFailed("CMS is not SignedData")
    signed_data = content["content"]
    signer_infos = signed_data["signer_infos"]
    if len(signer_infos) != 1:
        raise SignatureCheckFailed("unexpected SignerInfo count")
    signer_info = signer_infos[0]
    if signer_info["digest_algorithm"]["algorithm"].native != "sha256":
        raise SignatureCheckFailed("digest is not SHA-256")
    digest = hashlib.sha256(signed[:first_len] + signed[second_start:]).digest()
    attrs = {attr["type"].native: attr["values"][0].native for attr in signer_info["signed_attrs"]}
    if attrs.get("message_digest") != digest:
        raise SignatureCheckFailed("message digest does not match the document")

    roots = _trust_roots() if trust_roots is None else trust_roots
    context = ValidationContext(trust_roots=roots, allow_fetching=False)
    status = validate_pdf_signature(sig, signer_validation_context=context,
                                    ts_validation_context=ValidationContext(trust_roots=roots, allow_fetching=False))
    if not (status.intact and status.valid):
        raise SignatureCheckFailed("signature does not validate")
    if status.coverage != SignatureCoverageLevel.ENTIRE_FILE:
        raise SignatureCheckFailed("signature does not cover the whole file")

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    cert = x509.load_der_x509_certificate(status.signing_cert.dump())
    self_signed = _is_self_signed(cert)
    if status.trusted:
        trust, trust_reason = "trusted", None
    elif self_signed:
        trust, trust_reason = "untrusted", "self-signed"
    elif not roots:
        trust, trust_reason = "untrusted", "no-trust-list"
    else:
        trust, trust_reason = "untrusted", "not-in-trust-list"

    timestamp = {"status": "none"}
    if timestamped:
        ts = status.timestamp_validity
        if ts is None or not (ts.intact and ts.valid):
            raise SignatureCheckFailed("timestamp token does not validate")
        timestamp = {"status": "valid", "trusted": bool(ts.trusted), "time": ts.timestamp.astimezone(timezone.utc).isoformat()}

    signing_time = status.signer_reported_dt
    return {
        "signatureFormat": "PAdES (CMS detached), SHA-256",
        "fieldName": field_name,
        "integrity": "valid",
        "cryptographicallyValid": True,
        "coversWholeDocument": True,
        "trust": trust,
        "trustReason": trust_reason,
        "selfSigned": self_signed,
        "certificate": {
            "subject": _common_name(cert.subject),
            "issuer": _common_name(cert.issuer),
            "notBefore": cert.not_valid_before_utc.isoformat(),
            "notAfter": cert.not_valid_after_utc.isoformat(),
            "fingerprintSha256": cert.fingerprint(hashes.SHA256()).hex().upper(),
        },
        "validAtSigning": True,
        "revocation": "not-checked",
        "timestamp": timestamp,
        "signingTime": signing_time.astimezone(timezone.utc).isoformat() if signing_time else None,
        "signingTimeSource": "trusted-timestamp" if timestamped else "server-clock",
    }
