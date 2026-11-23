"""Exercise the browser's structured upload contract against a running synthetic-only solo server."""
import base64
from email import policy
from email.parser import BytesParser
import io
import json
import sys
import time
import zipfile

import pymupdf
from smoke import PNG, TOOLS, both, fixture_pdf, samples, session, settings, single, upload, verify


def workspace_settings():
    return {
        "split-pdf": {"splitMode":"every"},
        "delete-pdf-pages":{"strictPages":True,"pagesToDelete":"1"},
        "extract-pdf-pages":{"extractMode":"single","pages":"2"},
        "reorder-pages":{"pageOrder":[2,1]},
        "pdf-to-powerpoint":{"pptMode":"editable"},
        "pdf-watermark":{"watermarkOpacity":0.55},
        "pdf-encryption":{"encryption":"aes-128"},
        "protect-pdf":{"encryption":"aes-256"},
        "bates-numbering":{"prefix":"TEST-","startNumber":14,"padding":4},
        "redact-pdf":{"terms":["Alpha"],"redactions":[]},
        "sign-pdf":{"signMode":"visual","placement":{"page":1,"x":20,"y":130,"width":160,"height":45},
                    "signatureImage":"data:image/png;base64,"+base64.b64encode(PNG).decode()},
        "pdf-metadata-editor":{"title":"QA title","author":"Synthetic author","subject":"Synthetic subject","keywords":"synthetic"},
    }


def request(slug, files, option, parameters):
    cookie, csrf = session(slug)
    for _ in range(3):
        result = upload(slug, files, option, cookie, csrf, parameters)
        if result[0] != 429:
            return result
        time.sleep(61-time.time()%60)
    raise AssertionError("Rate limit did not reset")


def split_output(ranges, labels):
    source = fixture_pdf([f"MARKER {n}" for n in range(1,9)])
    status, headers, data = request("split-pdf",[("source.pdf",source)],"",{"splitMode":"ranges","ranges":ranges})
    assert status == 200
    if len(ranges)>1:
        assert headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files=[archive.read(name) for name in archive.namelist()]
    else:
        assert headers["content-type"] == "application/pdf"
        files=[data]
    assert len(files)==len(labels)
    for output, expected in zip(files, labels):
        with pymupdf.open(stream=output,filetype="pdf") as doc:
            assert [p.get_text().strip() for p in doc] == [f"MARKER {i}" for i in expected]


def unpack_report(headers, data):
    message = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: "+headers["content-type"]+"\r\n\r\n").encode()+data)
    fields = {part.get_param("name",header="content-disposition"):part for part in message.iter_parts()}
    pdf = fields["file"]
    assert pdf.get_content_type()=="application/pdf" and pdf.get_filename().endswith(".pdf")
    return json.loads(fields["summary"].get_payload(decode=True)), pdf.get_payload(decode=True)


def certificate_output():
    from datetime import datetime, timedelta, timezone
    from secrets import token_urlsafe
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID

    now = datetime.now(timezone.utc)
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,"Doxera synthetic untrusted signer")])
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1))
            .not_valid_after(now+timedelta(days=1)).add_extension(x509.BasicConstraints(ca=False,path_length=None),True)
            .add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),True)
            .sign(key,hashes.SHA256()))
    password = token_urlsafe(24)
    pfx = pkcs12.serialize_key_and_certificates(b"synthetic",key,cert,None,
                                               serialization.BestAvailableEncryption(password.encode()))
    status, headers, data = request("sign-pdf",single,"",{"signMode":"certificate",
        "certificate":base64.b64encode(pfx).decode(),"certificatePassword":password})
    assert status==200,("sign-pdf certificate",status)
    report, pdf = unpack_report(headers,data)
    assert report["integrity"]=="valid" and report["cryptographicallyValid"] and report["selfSigned"],list(report)
    assert pdf.startswith(single[0][1])
    with pymupdf.open(stream=pdf,filetype="pdf") as signed:
        assert signed.get_sigflags()>0 and len(signed)==2
    print("PASS certificate download and integrity report",flush=True)


def main():
    parameters = workspace_settings()
    for slug in TOOLS:
        files = single if slug=="sign-pdf" else samples.get(slug,single)
        status, headers, data = request(slug,files,settings.get(slug,""),parameters.get(slug,{}))
        assert status==200,(slug,status)
        if slug in {"sign-pdf","compare-pdf"}:
            report,data = unpack_report(headers,data)
            if slug=="sign-pdf":
                assert report["mode"]=="visual" and report["page"]==1
            else:
                assert report["totalDifferences"]>0 and report["differences"]
            headers["content-disposition"]="attachment; filename=report.pdf"
        verify(slug,data,headers)
        if slug=="pdf-metadata-editor":
            with pymupdf.open(stream=data,filetype="pdf") as pdf:
                assert all(pdf.metadata[k]==v for k,v in parameters[slug].items())
        print("PASS workspace",slug,flush=True)
    certificate_output()
    split_output(["1-3","4-8"],[[1,2,3],[4,5,6,7,8]])
    split_output(["2-4"],[[2,3,4]])
    split_output(["1-3","4-6","7-8"],[[1,2,3],[4,5,6],[7,8]])
    for spec in ["3-1","9","0"]:
        assert request("split-pdf",single,"",{"splitMode":"ranges","ranges":[spec]})[0]==422
    print("PASS split outputs (single, ranges, fixed-size groups) and invalid ranges",flush=True)


if __name__=="__main__":
    main()
