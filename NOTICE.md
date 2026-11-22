# Doxera Solo source notices

Doxera Solo application source is offered under GNU Affero General Public License version 3 only. The complete license appears in the repository root and worker directory. Original file-level notices and the project's recorded contributor credits accompany this release. The 22 November 2026 tools-only adaptation uses anonymous sessions, temporary local file handling and a single Gunicorn service. The 22 November 2026 RC2 revision adds a password gate and disables Office and HTML import. [LICENSE](LICENSE) · [CONTRIBUTORS.md](CONTRIBUTORS.md)

External dependencies retain their own licenses, copyrights and notices. The Docker build obtains these packages from their respective distributors. The source tag contains upstream attribution material and a record of the tested dependencies. The legal directory maps installed notice paths to byte-preserved copies named by their SHA-256. Debian copyright files may refer to named common licenses in the accompanying index.

- [Python packages and upstream version pages](legal/python-packages.csv)
- [Python license and notice files](legal/python-notices.csv)
- [Debian packages, exact source versions and copyright files](legal/debian-packages.csv)
- [Debian common license texts](legal/debian-common-licenses.csv)

PyMuPDF offers AGPL and commercial licensing. This release uses the open-source route and makes its build and application source available. PyMuPDF's two version-2.1 companion distributions have sparse metadata in the installed wheels. Upstream describes the Layout and PyMuPDF4LLM open-source transition. Doxera's Office conversions use LibreOffice. [PyMuPDF licensing](https://pymupdf.io/licensing) · [Artifex's Layout and PyMuPDF4LLM licensing announcement](https://pymupdf.io/blog/open-source-all-the-way-down-pymupdf4llm-goes-fully-agpl)

The Python metadata for FlatBuffers declares Apache 2.0. The openpyxl and et_xmlfile distributions declare MIT. Upstream materials identify their respective copyright holders. The Python base runtime and Debian-packaged fonts and applications retain their upstream terms. [CPython license](https://docs.python.org/3.11/license.html) · [FlatBuffers license](https://github.com/google/flatbuffers/blob/master/LICENSE) · [openpyxl version page](https://pypi.org/project/openpyxl/3.1.5/) · [et_xmlfile version page](https://pypi.org/project/et-xmlfile/2.0.0/)

A redistribution of built images or third-party binaries requires checking the applicable binary, notice and corresponding-source obligations for those artifacts. This release tag contains source files and license notices.

The RC3 tools interface adapts the Doxera catalog, workspaces and visual design on 22 November 2026. The browser bundle includes third-party code. Its build emits installed package license texts, copyright notices and the PDF.js notices at `/static/ui/licenses.txt`. Exact package versions and integrity hashes are recorded in the UI lockfile.
