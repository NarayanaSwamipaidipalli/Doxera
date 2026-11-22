"""The anonymous edition's public tool contract. No account integrations."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Tool:
    name: str
    category: str
    extensions: tuple = ("pdf",)
    minimum: int = 1
    maximum: int = 1
    prompt: str = ""
    choices: tuple = ()
    hint: str = ""


TOOLS = {
    "compress-pdf": Tool("Compress PDF", "Organize", prompt="Compression", choices=("medium", "low", "high")),
    "merge-pdf": Tool("Merge PDFs", "Organize", minimum=2, maximum=8, hint="Files are merged in selection order."),
    "split-pdf": Tool("Split PDF", "Organize", hint="Download one PDF per page, packaged together."),
    "rotate-pdf": Tool("Rotate PDF", "Organize", prompt="Clockwise rotation", choices=("90", "180", "270")),
    "delete-pdf-pages": Tool("Delete pages", "Organize", prompt="Pages to delete", hint="Use page numbers or ranges, such as 2, 4-6."),
    "extract-pdf-pages": Tool("Extract pages", "Organize", prompt="Pages to keep", hint="Use page numbers or ranges, such as 1, 3-5."),
    "reorder-pages": Tool("Reorder pages", "Organize", prompt="New page order", hint="List every page once, such as 3, 1, 2."),
    "pdf-to-word": Tool("PDF to Word", "Convert"),
    "pdf-to-excel": Tool("PDF to Excel", "Convert", hint="Extract tables and text into an XLSX workbook."),
    "pdf-to-powerpoint": Tool("PDF to PowerPoint", "Convert", hint="Place each page on its own slide."),
    "word-to-pdf": Tool("Word to PDF", "Convert", ("docx",)),
    "excel-to-pdf": Tool("Excel to PDF", "Convert", ("xlsx",)),
    "ppt-to-pdf": Tool("PowerPoint to PDF", "Convert", ("pptx",)),
    "image-to-pdf": Tool("Images to PDF", "Convert", ("png","jpg","jpeg","webp"), maximum=8),
    "pdf-to-image": Tool("PDF to PNG", "Convert", hint="Download a PNG per page at 200 DPI."),
    "html-to-pdf": Tool("HTML to PDF", "Convert", ("html","htm"), hint="External resources are blocked. Embed needed images in the file."),
    "pdf-watermark": Tool("Watermark PDF", "Edit", prompt="Watermark text"),
    "pdf-encryption": Tool("Encrypt PDF", "Protect", prompt="New password", hint="Use at least 8 characters for AES-256 encryption."),
    "protect-pdf": Tool("Password protect PDF", "Protect", prompt="New password", hint="Use at least 8 characters for AES-256 encryption."),
    "unlock-pdf": Tool("Unlock PDF", "Protect", prompt="Current password"),
    "bates-numbering": Tool("Bates numbering", "Edit", prompt="Number prefix", hint="For example, DOC-."),
    "redact-pdf": Tool("Redact searchable text", "Protect", prompt="Word or phrase to remove", hint="Removes matching searchable text. Review every page before sharing."),
    "sign-pdf": Tool("Sign PDF visually", "Edit", ("pdf","png"), minimum=2, maximum=2,
                     hint="Choose one PDF and one PNG signature. Places a visual signature at the bottom of page one. No certificate is issued."),
    "compare-pdf": Tool("Compare PDFs", "Edit", minimum=2, maximum=2, hint="Choose the original first and the revised file second."),
    "pdf-metadata-editor": Tool("Edit PDF title", "Edit", prompt="New document title"),
    "pdf-repair": Tool("Repair PDF", "Edit"),
    "ocr-pdf": Tool("Make scans searchable", "Convert", prompt="Document language", choices=("eng","deu","fra","spa","jpn")),
    "batch-processing": Tool("Batch compress PDFs", "Organize", minimum=2, maximum=8, hint="Compress each PDF separately and download a ZIP."),
}

UNAVAILABLE = {
    "ai-pdf-summary": "AI PDF Summary", "ai-pdf-chat": "PDF Chat",
    "ai-document-qa": "Document Q&A", "ai-invoice-extraction": "Invoice Extraction",
    "ai-contract-analysis": "Contract Analysis", "ai-resume-parser": "Résumé Parser",
    "ai-document-translator": "Document Translator",
}
