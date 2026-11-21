# Doxera — Open-Source Release Audit (AGPLv3 Preparation)

**Decision: BLOCKED — do not make the repository public yet.**

Prepared 2026-11-21 from the authenticated GitHub connection. This is a **remote-code review**, not a review of the latest Windows working tree or complete Git history. It is not legal advice and does not establish regulatory or license compliance.

## Reviewed references

- GitHub repository: `NarayanaSwamipaidipalli/Doxera` (private when inspected).
- `main`: `f94630a431999b43eae94a60ff25a0e006a4680f` (last commit examined dated 2026-11-06).
- `staging`: `7173bbc952ef4e691e465d5616698fd70ebb2de3` (last commit examined dated 2026-11-09).
- `licensing/agpl-v3-prep`: a separate branch based on `main`, containing the canonical text of **GNU AGPLv3** in `LICENSE`.
- The owner's more recent local files at `C:\Users\rough\Doxera`, including many staged changes, were **not available through this connection**. Their security, licensing, and latest functionality must be reviewed before publication.

## Findings and decisions

| Item | Observation | Required action | Status |
|---|---|---|---|
| Project license | No root `LICENSE` on examined `main` or `staging`. Official AGPLv3 text added only on prep branch. | Review, merge and publish the selected license *after* gates pass. Determine whether code is `AGPL-3.0-only`; do not silently change to "or later". | PREPARED |
| Rights and contributor ownership | No verified complete contributor/copyright assignment evidence in this review. | Confirm contributors have authority to license their contributions under AGPLv3; identify any code/assets not owned by project. | BLOCKED |
| Worker dependencies | `services/pdf-worker/requirements.txt` on `staging` includes `PyMuPDF==2.1` and `pdf2docx==0.5.13`. `pdf2docx` uses PyMuPDF. | Inventory direct/transitive packages in actual final worker image; obtain legal review of AGPL obligations and corresponding source availability. | BLOCKED |
| Ghostscript / document binaries | Worker installs Tesseract and LibreOffice; README refers to Ghostscript. Actual final image/package tree not inspected. | Generate a runtime package/SBOM inventory and review license/notice obligations, including any Ghostscript use. | BLOCKED |
| SDK licenses | `sdks/node/package.json` declares Apache-2.0; `sdks/python/pyproject.toml` classifier and Python SDK README identify Apache-2.0. | Decide and document whether SDKs remain separately Apache-2.0 (if rights permit) or will be AGPL-licensed; align notices and metadata, and check code provenance. | BLOCKED |
| README claims | Current remote README advertises an "Enterprise" license badge and contains infrastructure/security descriptions inconsistent with separately verified current deployments; outdated PDFForge names persist. | Replace with accurate AGPLv3 and tested-feature claims; correct retention, malware scanning, hosting and AI statements to match implemented behavior. | BLOCKED |
| Network source offer | AGPLv3 Section 13 is relevant to modified covered software interacted with over a network. | Provide a prominent source-code offer/link in the web app, consistent with the actual deployed commit, and include Corresponding Source/build scripts as applicable. Obtain legal review of scope. | BLOCKED |
| Existing deployment | No Render services were present in the connected confirmed workspace during the earlier inspection. | Do not claim staging/public availability or source-offer compliance until deployed and verified. | BLOCKED |
| Publication exposure | Remote `staging` Git tree contained no obvious tracked `.pdf`, private-key extensions, or unignored `.env` file names. Keyword searches of current `main` found code/test references, not proof of exposed secrets. | Run a full secret scan of **all branches, tags and Git history**, artifacts, local changes and known public forks; rotate real secrets if discovered. No clean bill of health from filename/search sampling. | BLOCKED |
| Security and privacy | Repo contains security documentation and privacy text, but the reviewed remote branches predate many owner-reported repairs. | Verify current security findings, real privacy request delivery, retention enforcement, secrets and user-data exposure in final release commit. | BLOCKED |
| Test and build reproducibility | Prior owner reports describe numerous tests and fixes, but these were not executed in this GitHub-only audit. | Run final worker/API/web test suites, dependency/license audit, reproducible container build and PDF-output tests at exact release SHA. | BLOCKED |

## Publication gates

1. Confirm ownership and permission to relicense **all original application code, SDKs, text, design assets, and contributed code**. Treat externally sourced snippets separately.
2. Decide whether the Node and Python SDKs remain Apache-2.0 or are relicensed; ensure SPDX metadata/README/package notices are consistent with actual chosen licenses.
3. Inventory all Python/JS/Linux transitive dependencies, deployed binaries, fonts and assets. Retain their copyright and license notices. In particular review PyMuPDF, pdf2docx, MuPDF, Ghostscript, LibreOffice and any code copied from other repositories.
4. Update public-facing README, Docs/Terms/Privacy, and web app with accurate claims and the network source-availability offer where required.
5. Review local **staged and unstaged** changes in `C:\Users\rough\Doxera` without resetting their Git index. Audit remote `main`/`staging` and latest working tree before preparing a reviewable release branch.
6. Scan **entire Git history** and any previous public repository exposures for secrets, credentials, internal URLs, sensitive documents and personal data. Remove/disclose/rotate only after assessed, without destructive history rewrites by default.
7. Validate all builds, official license notices, privacy contact, retention and external beta gates on exact candidate images.
8. Request human review of this checklist and explicit authorization before merging the AGPL preparation branch or changing repository visibility.

## Proposed local Codex handoff

In VS Code open `C:\Users\rough\Doxera` and instruct Codex:

> Audit my entire current local Doxera working tree for public AGPLv3 release. Read `docs/OPEN_SOURCE_RELEASE_AUDIT.md` from GitHub branch `licensing/agpl-v3-prep` as a reference, plus local launch and third-party-license docs. Preserve the existing staged index. List all tracked/untracked sensitive files and scan all Git history for secrets with redacted output. Generate a software bill of materials for frontend, API, PDF worker, OS binaries and SDKs. Inspect code ownership and conflicting license metadata. Prepare proposed README, legal notices, source-offer and privacy changes on a **separate review branch** without deploying, merging, pushing, publishing, or changing visibility. Provide precise FAIL/BLOCKED/PASS evidence and request owner decisions.

### Notes

- Existing `LICENSE` file is the verbatim AGPLv3 text, from `spdx/license-list-data/text/AGPL-3.0-only.txt`.
- This document does **not** authorize publication of private repository history or permit use of third-party materials without license review.
- Commercial SaaS hosting and charging for service are not automatically prohibited by AGPLv3, but network-source and other license obligations apply.
- Keep Doxera's public release and external beta **BLOCKED** until the applicable technical, legal, privacy and operational checks pass.
