"""Run inside an isolated QA client container against a real solo gunicorn instance."""
import base64
import http.client
import os
from urllib.parse import urlsplit
import io
import json
import re
import sys
import time
import uuid
import zipfile
from pathlib import Path
import pymupdf
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from openpyxl import Workbook, load_workbook
from pptx import Presentation
from solo.catalog import TOOLS, UNAVAILABLE, COMING_SOON


def fixture_pdf(labels):
    with pymupdf.open() as pdf:
        for label in labels:
            pdf.new_page().insert_text((50,80), label, fontsize=20)
        return pdf.tobytes()


def image(text, size):
    source = Image.new("RGB", size, "white")
    ImageDraw.Draw(source).text((15,15), text, fill="black",
        font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 52))
    out = io.BytesIO()
    source.save(out, "PNG")
    return out.getvalue()


def packed(doc):
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def call(method, path, data=None, headers=None):
    target = urlsplit(sys.argv[1] if "://" in sys.argv[1] else "http://" + sys.argv[1])
    if target.scheme not in {"http", "https"} or target.path not in {"", "/"} or target.username or not target.hostname:
        raise ValueError("Supply a service origin")
    headers = dict(headers or {})
    password = os.environ.get("SOLO_TRIAL_PASSWORD")
    if password:
        if target.scheme != "https" and os.environ.get("SOLO_LOCAL_TEST") != "1":
            raise ValueError("Trial credentials require HTTPS outside an isolated local test")
        headers["Authorization"] = "Basic " + base64.b64encode(("owner:" + password).encode()).decode()
    client = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
    conn = client(target.hostname, target.port, timeout=115)
    conn.request(method, path, body=data, headers=headers)
    response = conn.getresponse()
    result = (response.status, dict((k.lower(),v) for k,v in response.getheaders()), response.read())
    conn.close()
    return result


def upload(slug, files, option, cookie, csrf):
    boundary = uuid.uuid4().hex
    parts = []
    for k,v in (("csrf",csrf), ("option",option)):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for name, data in files:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
        parts.extend((data,b"\r\n"))
    parts.append(f'--{boundary}--\r\n'.encode())
    return call("POST", "/tools/"+slug, b"".join(parts),
                {"Content-Type":"multipart/form-data; boundary="+boundary,"Cookie":cookie})


def session(slug):
    status, headers, doc = call("GET","/tools/"+slug)
    assert status == 200 and b"50 MB" in doc
    assert "HttpOnly" in headers["set-cookie"] and "Secure" in headers["set-cookie"]
    return headers["set-cookie"].split(";")[0], re.search(b'name="csrf" value="([^"]+)"',doc)[1].decode()


PDF = fixture_pdf(["Alpha Fixture", "Beta Fixture"])
DOC = Document()
DOC.add_paragraph("Office Fixture")
BOOK = Workbook()
BOOK.active["A1"] = "Office Fixture"
SLIDES = Presentation()
SLIDES.slides.add_slide(SLIDES.slide_layouts[5]).shapes.title.text = "Office Fixture"
PNG = image("Fixture", (500,120))
with pymupdf.open() as pdf:
    page = pdf.new_page(width=600,height=200)
    page.insert_image(page.rect,stream=image("Searchable Fixture", (1000,230)))
    SCAN = pdf.tobytes()
with pymupdf.open(stream=PDF,filetype="pdf") as pdf:
    PASSWORD = uuid.uuid4().hex
    LOCKED = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,user_pw=PASSWORD,owner_pw=uuid.uuid4().hex)

settings = {"compress-pdf":"medium","rotate-pdf":"90","delete-pdf-pages":"1","extract-pdf-pages":"2",
    "reorder-pages":"2,1","pdf-watermark":"DRAFT","pdf-encryption":PASSWORD,"protect-pdf":PASSWORD,
    "unlock-pdf":PASSWORD,"bates-numbering":"TEST-","redact-pdf":"Alpha","pdf-metadata-editor":"QA title","ocr-pdf":"eng"}
single = [("sample.pdf",PDF)]
both = single + [("updated.pdf",fixture_pdf(["Revised Fixture"]))]
samples = {"word-to-pdf":[("fixture.docx",packed(DOC))], "excel-to-pdf":[("fixture.xlsx",packed(BOOK))],
    "ppt-to-pdf":[("fixture.pptx",packed(SLIDES))], "image-to-pdf":[("art.png",PNG)], "html-to-pdf":[("fixture.html",b"<h1>HTML Fixture</h1>")],
    "sign-pdf":single+[("signature.png",PNG)],"unlock-pdf":[("locked.pdf",LOCKED)],"ocr-pdf":[("scan.pdf",SCAN)]}
for name in ("merge-pdf","compare-pdf","batch-processing"):
    samples[name] = both


def verify(slug, data, headers):
    assert data and "attachment;" in headers["content-disposition"] and "no-store" in headers["cache-control"]
    stream = io.BytesIO(data)
    if slug == "pdf-to-word":
        doc=Document(stream)
        text=" ".join(p.text for p in doc.paragraphs)
        assert "Alpha" in text or "Alpha" in doc._element.xml
    elif slug == "pdf-to-excel":
        book=load_workbook(stream)
        assert "Alpha" in str(list(book.active.values))
    elif slug == "pdf-to-powerpoint":
        pres=Presentation(stream)
        assert len(pres.slides)==2 and all(len(s.shapes)>0 for s in pres.slides)
    elif slug in ("split-pdf","pdf-to-image","batch-processing"):
        with zipfile.ZipFile(stream) as z:
            assert z.testzip() is None and len(z.namelist())==2
            for i,n in enumerate(z.namelist()):
                raw=z.read(n)
                if slug=="pdf-to-image":
                    with Image.open(io.BytesIO(raw)) as img:
                        assert img.size[0]>100 and img.convert("L").getextrema()[0] < 200
                else:
                    with pymupdf.open(stream=raw,filetype="pdf") as doc:
                        expected=["Alpha","Beta"][i] if slug=="split-pdf" else ["Alpha","Revised"][i]
                        assert expected in doc[0].get_text()
    else:
        with pymupdf.open(stream=data,filetype="pdf") as doc:
            if slug in ("pdf-encryption","protect-pdf"):
                assert doc.needs_pass and doc.authenticate(PASSWORD)
            text=" ".join(p.get_text() for p in doc)
            assert doc.page_count>0
            if slug=="merge-pdf": assert doc.page_count==3 and "Revised" in doc[-1].get_text()
            elif slug=="rotate-pdf": assert doc[0].rotation==90
            elif slug in ("extract-pdf-pages","delete-pdf-pages"): assert len(doc)==1 and "Beta" in text
            elif slug=="reorder-pages": assert "Beta" in doc[0].get_text()
            elif slug in ("word-to-pdf","ppt-to-pdf","excel-to-pdf"): assert "Office" in text
            elif slug=="html-to-pdf": assert "HTML Fixture" in text
            elif slug=="pdf-metadata-editor": assert doc.metadata["title"]=="QA title"
            elif slug=="pdf-watermark": assert "DRAFT" in text
            elif slug=="bates-numbering": assert "TEST-" in text
            elif slug=="redact-pdf": assert "Alpha" not in text and "Beta" in text
            elif slug=="sign-pdf": assert doc[0].get_images() and "Alpha" in text
            elif slug=="compare-pdf": assert "Revised" in text or "comparison" in text.lower()
            elif slug=="ocr-pdf": assert "Fixture" in text
            elif slug=="image-to-pdf": assert doc[0].get_images()
            else: assert "Alpha" in text


def main():
    assert call("GET","/health")[0]==200
    failures=[]
    for slug in TOOLS:
        try:
            cookie,csrf=session(slug)
            for attempt in range(2):
                status,headers,data=upload(slug,samples.get(slug,single),settings.get(slug,""),cookie,csrf)
                if status!=429: break
                time.sleep(61-time.time()%60)
            assert status==200, f"HTTP {status}"
            verify(slug,data,headers)
            print("PASS",slug,flush=True)
        except Exception as exc:
            failures.append(slug)
            print("FAIL",slug,type(exc).__name__,str(exc)[:60] if isinstance(exc,AssertionError) else "",flush=True)
    for slug in (*UNAVAILABLE, *COMING_SOON):
        assert call("GET","/tools/"+slug)[0]==404 and call("POST","/tools/"+slug,b"")[0]==404
    print("Disabled catalog routes denied:",len(UNAVAILABLE) + len(COMING_SOON),flush=True)
    if failures: raise SystemExit("Failed workflows: "+", ".join(failures))


if __name__=="__main__":main()
