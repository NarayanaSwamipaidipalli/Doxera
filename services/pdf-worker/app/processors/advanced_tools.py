import os
from typing import Dict, Any, List
import pymupdf
from .ocr_tools import ocr_pdf

def compare_pdfs(path_a: str, path_b: str, output_diff_path: str) -> Dict[str, Any]:
    """Compatibility entry point for callers of the original processor."""
    from .compare_tools import compare_pdfs as compare
    return compare(path_a, path_b, output_diff_path)

def repair_pdf(input_path: str, output_path: str) -> str:
    """
    Reconstructs corrupted cross-reference (XREF) tables, recovers orphaned objects,
    and repairs corrupted PDF stream dictionaries.
    """
    # PyMuPDF reconstructs broken xref tables automatically on open
    doc = pymupdf.open(input_path)
    # Save with full garbage collection level 4 and stream sanitation
    doc.save(
        output_path,
        garbage=4,
        clean=True,
        deflate=True
    )
    doc.close()
    return output_path

def edit_metadata(
    input_path: str,
    output_path: str,
    title: str = None,
    author: str = None,
    subject: str = None,
    keywords: str = None
) -> str:
    """Modifies the document Information Dictionary (metadata headers)."""
    doc = pymupdf.open(input_path)
    meta = doc.metadata or {}
    
    if title is not None:
        meta['title'] = title
    if author is not None:
        meta['author'] = author
    if subject is not None:
        meta['subject'] = subject
    if keywords is not None:
        meta['keywords'] = keywords
        
    meta['producer'] = 'Doxera Enterprise Engine (doxera.in)'
    doc.set_metadata(meta)
    doc.save(output_path, garbage=3)
    doc.close()
    return output_path

def apply_bates_numbering(
    input_path: str,
    output_path: str,
    prefix: str = "BATES",
    start_number: int = 1,
    digits: int = 6,
    position: str = "bottom-right"
) -> str:
    """
    Applies sequential Bates numbering across all pages for legal and regulatory compliance.
    """
    doc = pymupdf.open(input_path)
    seq = start_number

    for page in doc:
        rect = page.rect
        formatted_bates = f"{prefix}-{str(seq).zfill(digits)}"

        if position == "bottom-right":
            pt = pymupdf.Point(rect.width - 130, rect.height - 18)
        elif position == "bottom-left":
            pt = pymupdf.Point(36, rect.height - 18)
        elif position == "top-right":
            pt = pymupdf.Point(rect.width - 130, 28)
        else:
            pt = pymupdf.Point(rect.width / 2 - 40, rect.height - 18)

        page.insert_text(
            pt,
            formatted_bates,
            fontsize=9,
            fontname="Helvetica-Bold",
            color=(0.2, 0.2, 0.2)
        )
        seq += 1

    doc.save(output_path, garbage=3, deflate=True)
    doc.close()
    return output_path

def redact_sensitive_text(
    input_path: str,
    output_path: str,
    keywords: List[str] = None
) -> Dict[str, Any]:
    """
    Irreversibly redacts targeted keywords, PII, and custom search terms from PDF.
    PyMuPDF apply_redactions() removes the matched text from the page content.
    """
    doc = pymupdf.open(input_path)
    targets = keywords or ["CONFIDENTIAL", "SSN", "PASSWORD", "SECRET"]
    total_redactions = 0

    for page in doc:
        for word in targets:
            rl = page.search_for(word)
            for rect in rl:
                annot = page.add_redact_annot(rect, fill=(0, 0, 0))
                total_redactions += 1
        page.apply_redactions()

    doc.save(output_path, garbage=4, deflate=True, clean=True)
    doc.close()
    return {
        "outputPath": output_path,
        "redactionsApplied": total_redactions,
        "keywordsRedacted": targets
    }
