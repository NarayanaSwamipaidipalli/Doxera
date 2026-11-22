"""Fetch the pinned Artifex release in resumable pieces and verify the joined archive."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from http.client import HTTPException
from pathlib import Path
from tempfile import TemporaryDirectory
from time import sleep
from urllib.error import URLError
from urllib.request import Request, urlopen

SOURCE = "https://github.com/ArtifexSoftware/mupdf-downloads/releases/download/1.28.6/mupdf-1.28.6-source.tar.gz"
SIZE = 68_924_915
SHA256 = "dc85000640a45d90ca9b77b061f6ca67cce0c4d4fbecf8819647baf573eef101"
CHUNK = 1024 * 1024


def fetch_archive(destination):
    with urlopen(Request(SOURCE, method="HEAD"), timeout=60) as response:
        url = response.geturl()
    with TemporaryDirectory() as work:
        def fetch(start):
            end = min(start + CHUNK, SIZE) - 1
            request = Request(url, headers={"Range": f"bytes={start}-{end}"})
            for attempt in range(4):
                try:
                    with urlopen(request, timeout=90) as response:
                        if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{SIZE}":
                            raise ValueError("Unexpected upstream byte range")
                        block = response.read(CHUNK + 1)
                    if len(block) != end - start + 1:
                        raise OSError("Incomplete upstream response")
                    path = Path(work) / str(start)
                    path.write_bytes(block)
                    return path
                except (OSError, HTTPException, URLError):
                    if attempt == 3:
                        raise
                    sleep(2 ** attempt)

        digest = sha256()
        with ThreadPoolExecutor(8) as pool, destination.open("wb") as out:
            for part in pool.map(fetch, range(0, SIZE, CHUNK)):
                data = part.read_bytes()
                digest.update(data)
                out.write(data)
    if digest.hexdigest() != SHA256:
        raise ValueError("MuPDF upstream archive checksum mismatch")


if __name__ == "__main__":
    fetch_archive(Path("/mupdf.tar.gz"))
