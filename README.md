# Doxera Solo

The public Doxera Solo service offers 23 distinct working PDF tools without an account. The two existing encryption URLs share one Protect PDF tool. Word, Excel, PowerPoint and HTML imports display Coming soon. Seven earlier catalog entries are disabled and hidden from the homepage. Accepted upload types are PDF, PNG, JPEG and WebP. The site describes file handling and lists the operator and privacy contact on its [terms and privacy page](https://doxera-solo.onrender.com/terms-and-privacy).

The Solo runtime keeps its tested Python processor package in `services/pdf-worker/solo/runtime/app`. `Dockerfile.solo` installs that package as `/app/app`; the account-based application's existing `services/pdf-worker/app` remains separate. This keeps both applications' processing behavior intact when building either Dockerfile.

## Homepage catalog

Display names, short descriptions and per-tool `enabled` flags live in `services/pdf-worker/ui/src/lib/tools.json`, shared by React and the UTF-8 Python template loader. Set `enabled` to `false` to hide a card. To publish a tool later, implement and register its processor in `solo/catalog.py` before setting `enabled` to `true`; a display flag does not enable processing. Coming soon previews are capped at four. The legacy `/tools/pdf-encryption` route still works but is excluded from the 23-tool marketing count. Rebuild the UI and service after changing the catalog.

The About page is `/about`. Shared footer credits name Narayana Swami Paidipalli and Potturi Naga Vydehi, with `roughnarayana@gmail.com` on the About page.

## Build and run

Run these commands in Bash from the repository root on a machine with Docker. Generate a unique trial password in your password manager.

```sh
docker build --file services/pdf-worker/Dockerfile.solo --tag doxera-solo:rc4 services/pdf-worker
export SOLO_SESSION_SECRET="$(openssl rand -hex 32)"
read -rs -p "Trial password (at least 24 characters): " SOLO_TRIAL_PASSWORD
echo
export SOLO_TRIAL_PASSWORD
export SOLO_PRIVACY_EMAIL='roughnarayana@gmail.com'
docker run --rm --name doxera-solo --cpus 1 --memory 2g --memory-swap 2g \
  -p 127.0.0.1:10000:10000 -e SOLO_TRIAL_PASSWORD -e SOLO_SESSION_SECRET -e SOLO_PRIVACY_EMAIL doxera-solo:rc4
```

The local example defaults to trial access. Open localhost on port 10000 and sign in as `owner` with your trial password. The health endpoint is `/health`.

The hosted service uses HTTPS and the `solo-tools` branch. Its `render.solo.yaml` Blueprint selects `SOLO_ACCESS_MODE=public` and generates the session signing secret. To restore owner-only access, set a strong `SOLO_TRIAL_PASSWORD` in Render and select `SOLO_ACCESS_MODE=trial`. Trial mode requires a password to start. The source link on the hosted site downloads the exact running commit.

The temporary service storage is private to the running instance. Uploaded files are limited to 50 MB each. Results are streamed once. Normal completion removes the file paths immediately and the orphan sweeper runs before one hour.

## Verify with synthetic documents

The regression fixtures are generated at test time. Make `services/pdf-worker/solo_tests` available read-only as `/qa` to a client container using the release image. Pass the trial password via `-e SOLO_TRIAL_PASSWORD` to the client. Run `python /qa/smoke.py SERVER_ALIAS:10000` with `PYTHONPATH=/app` and `SOLO_LOCAL_TEST=1` on an isolated Docker network shared with the server. For a hosted trial, supply the full HTTPS origin and omit the local-test variable. The script exercises all 24 available downloads and eleven disabled routes. Run the safeguard and image compression tests in a separate container with its own signing secret.

```sh
docker run --rm --network none -e SOLO_TRIAL_PASSWORD -e SOLO_SESSION_SECRET -e PYTHONPATH=/app \
  -v "$PWD/services/pdf-worker/solo_tests:/qa:ro" doxera-solo:rc4 \
  python -m unittest discover -s /qa
```

This tag distributes application and build source. The reviewed Linux/amd64 Docker build used Python 3.11 slim at digest `sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535`. The Dockerfile uses a floating base tag and package repositories. Compare later builds to the tested Python and Debian package inventories. Preserve the application license, contributor credits and third-party notices when redistributing. [Application license](LICENSE) · [Contributors](CONTRIBUTORS.md) · [Third-party notices](NOTICE.md)

## Office import maintenance

The parser upgrade plan covers Expat, both libxml2 distributions and the conditions for reopening each import route. [Office parser update plan](docs/OFFICE_PARSER_UPDATE.md)

The [tool-by-tool comparison](docs/FULL_SOLO_PARITY.md) records which interfaces and processors are shared, the output differences and the Docker verification. The image builds the React interface before the Python runtime stage. Use the UI dependency stage to run `npm test` with the UI sources and Vitest configuration mounted at `/build`. Run `workspaces.py` beside the smoke client to test structured options and report downloads.

For the Chromium check, generate an eight-page synthetic fixture inside the Python QA container with the mounted smoke helper. Place its output on a disposable QA mount. Give the browser container `solo_tests/browser.cjs`, the generated PDF as `/qa/fixture.pdf`, Chromium, `playwright-core` and the trial password. Run `node /qa/browser.cjs` with `--network container:doxera-solo` so its loopback address reaches the trial server. Set `CHROMIUM_PATH` if the executable is elsewhere.

```sh
python -c "from smoke import fixture_pdf; from pathlib import Path; Path('/out/fixture.pdf').write_bytes(fixture_pdf([str(i) for i in range(1,9)]))"
```


---

# Existing account-based application

# PDFForge AI – Enterprise PDF Intelligence Platform
> High-throughput, cloud-native PDF processing and document intelligence SaaS platform engineered for millions of concurrent users.

[![License](https://img.shields.io/badge/License-Enterprise-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15_App_Router-black)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-10.4-red)](https://nestjs.com)
[![PyMuPDF](https://img.shields.io/badge/PyMuPDF-1.24-green)](https://pymupdf.readthedocs.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_+_pgvector-blue)](https://postgresql.org)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-EKS_v1.30-326CE5)](https://kubernetes.io)

---

## 🌟 Executive Overview

**PDFForge AI** is a production-grade, enterprise alternative to platforms like iLovePDF and Adobe Acrobat Web, elevated with state-of-the-art **AI Document Intelligence (RAG)**, automated invoice & contract auditing, zero-data-retention compliance, and multi-tenant team workspaces.

The platform processes deterministic document manipulations (lossless compression, vector rasterization, office conversions, OCR) through an auto-scaling Python worker cluster, coordinated by an asynchronous NestJS API Gateway and Redis/Celery queue fabric.

---

## 🏗 System Architecture

```
User Upload (Web / Mobile)
     │ (Direct Presigned Upload - Client to S3)
     ▼
AWS S3 Bucket (SSE-KMS AES-256) ─── Lifecycle Rule (24h Cryptographic Purge)
     ▲
     │ Dequeue / Stream to RAMFS
     ▼
Celery Worker Cluster (Python 3.12 / PyMuPDF / Tesseract / Ghostscript / LibreOffice)
     │
     ├── In-Memory ClamAV Exploit & Malware Scan
     ├── Processing Transformation (Merge, Split, Compress, OCR, Convert)
     ├── AI Semantic Extraction (Table Extraction, RAG Chunking)
     ▼
PostgreSQL 16 (pgvector) + Redis Cluster (Telemetry, Rate-Limiting, State)
     ▲
     │
NestJS API Gateway (JWT, OAuth 2.0, Stripe/Razorpay, REST & GraphQL)
     ▲
     │
Next.js 15 Frontend (App Router, Tailwind CSS, Apple-Minimalist UI)
```

---

## 📁 Repository Structure

```
pdfforge-ai/
├── apps/
│   ├── web/                    # Next.js 15 App Router Frontend
│   │   ├── src/app/            # Landing, /tools/[slug], /ai-studio, /dashboard, /pricing, /admin, etc.
│   │   ├── src/components/     # Layout, Navbar, Footer, Studio widgets
│   │   ├── src/lib/            # Tools registry (30+ tools), API client, Zustand store
│   │   └── tailwind.config.ts  # Apple-inspired aesthetic theme
│   └── api/                    # NestJS API Gateway & Core Microservice
│       ├── prisma/             # Multi-tenant schema with pgvector
│       ├── src/auth/           # JWT, Refresh rotation, Google OAuth, RBAC
│       ├── src/files/          # S3 presigned URLs, streaming, ephemeral purge
│       ├── src/pdf-jobs/       # Job dispatcher & Celery/Redis queue manager
│       ├── src/ai/             # RAG Q&A, Summarization, Invoice/Contract extractor
│       ├── src/billing/        # Stripe & Razorpay webhook handlers
│       ├── src/organizations/  # Team workspaces, member invites, RBAC roles
│       └── src/admin/          # System observatory, telemetry, audit logs
├── services/
│   └── pdf-worker/             # Python 3.12 FastAPI + Celery Processing Engine
│       ├── app/processors/     # PyMuPDF, OCR, LibreOffice, Visual Diff, Repair
│       ├── app/ai/             # Table extraction & semantic chunker
│       └── Dockerfile          # Multi-tool image with Tesseract & Ghostscript
├── mobile/
│   ├── android/                # Native Kotlin + Jetpack Compose app
│   └── ios/                    # Native Swift + SwiftUI + VisionKit scanner
├── infrastructure/
│   ├── docker/                 # NGINX reverse proxy & rate limiter config
│   ├── k8s/                    # Production Kubernetes deployments, HPA, Ingress
│   └── terraform/              # AWS EKS, S3 with KMS, Aurora, ElastiCache
├── docs/
│   ├── ARCHITECTURE.md         # Detailed architectural design & sequence diagrams
│   ├── API_DOCUMENTATION.md    # OpenAPI 3.0 & GraphQL specification
│   ├── SECURITY_COMPLIANCE.md  # GDPR, HIPAA, SOC2, DoD 5220.22-M zero-retention
│   ├── AWS_DEPLOYMENT.md       # Step-by-step cloud rollout guide
│   └── TESTING_STRATEGY.md     # Test suite & Locust 50k concurrency load script
└── docker-compose.yml          # Complete local stack orchestration
```

---

## ⚡ Quick Start (Local Development)

### 1. Launch with Docker Compose
Orchestrate PostgreSQL, Redis, MinIO S3, the NestJS API Gateway, Python PDF Worker, and Next.js Frontend with a single command:

```bash
docker-compose up --build
```

Access the services:
- **Web Frontend**: `http://localhost:3000`
- **API Gateway & Swagger Docs**: `http://localhost:4000/api/docs`
- **Python Worker Docs**: `http://localhost:8000/docs`
- **MinIO S3 Console**: `http://localhost:9001` (User: `minioadmin` / Pass: `minioadmin`)

---

### 2. Run Without Docker or VS Code (one command)
With Node.js 20+, Python 3.12+, PostgreSQL 16 and Redis installed natively, run from any terminal:

```bash
./scripts/run-local.sh        # installs deps on first run, migrates the DB, starts everything
./scripts/run-local.sh stop   # stops all services it started
```

It creates the `pdfforge` database user, generates local dev secrets in `.local/dev.env`, and starts
S3 storage (a `minio` binary if on PATH, otherwise a `moto` S3 mock), the Python worker, Celery, the
NestJS API and the Next.js web app. Logs go to `.local/logs/`.

---

### 3. Manual Development Mode

#### Backend API Gateway (NestJS)
```bash
cd apps/api
npm install
npx prisma generate
npm run start:dev
```

#### Python PDF Processing Worker
```bash
cd services/pdf-worker
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# In a separate terminal, launch Celery worker:
celery -A app.celery_app.celery_app worker --loglevel=info
```

#### Frontend Web Application (Next.js 15)
```bash
cd apps/web
npm install
npm run dev
```

---

## 🛡 Security & Compliance Highlights

- **Zero-Permanent-Storage Principle**: Documents are held in volatile RAM mounts during execution and shredded via **DoD 5220.22-M** 3-pass cryptographic wipe routines.
- **Ephemeral S3 Lifecycle**: Automatic 24-hour expiration rule permanently deletes raw and processed files from S3 buckets.
- **ClamAV Anti-Malware Protection**: Pre-processing virus scanning checks for embedded malicious PDF objects (`/JS`, `/Launch`, exploits).
- **Compliance Ready**: Fully engineered to meet **GDPR (Articles 17 & 32)**, **HIPAA BAA**, and **SOC2 Type II** specifications.

---

## 📱 Mobile Native Applications

- **Android (Kotlin)**: Jetpack Compose UI, CameraX & ML Kit Document Scanner with automatic edge cropping, and Retrofit network client.
- **iOS (Swift)**: SwiftUI, Apple VisionKit `VNDocumentCameraViewController` scanner, and URLSession async/await client.

---

## 📄 Documentation Links

- [Complete System Architecture](docs/ARCHITECTURE.md)
- [REST & GraphQL API Documentation](docs/API_DOCUMENTATION.md)
- [Security, Privacy & Compliance Whitepaper](docs/SECURITY_COMPLIANCE.md)
- [On-Premise Private LLM & Air-Gapped Deployment](docs/ON_PREMISE_LLM.md)
- [AWS Production Cloud Deployment Guide](docs/AWS_DEPLOYMENT.md)
- [Testing & Concurrency Load Benchmark](docs/TESTING_STRATEGY.md)

---
*Authored with enterprise software engineering standards by the PDFForge AI Architecture Team.*
