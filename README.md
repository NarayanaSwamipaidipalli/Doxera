# Doxera Solo

This source release runs Doxera's 28 anonymous PDF tools on a single Linux web service. Seven unavailable catalog entries are disabled. This release candidate is for synthetic testing while the native parser security review is open.

## Build and run

Run these commands from the repository root on a machine with Docker.

```sh
docker build --file services/pdf-worker/Dockerfile.solo --tag doxera-solo:rc1 services/pdf-worker
export SOLO_SESSION_SECRET="$(openssl rand -hex 32)"
export SOLO_PRIVACY_EMAIL='roughnarayana@gmail.com'
export SOLO_SOURCE_URL='https://github.com/NarayanaSwamipaidipalli/Doxera/archive/refs/tags/solo-v1.0.0-rc.1.tar.gz'
docker run --rm --name doxera-solo --cpus 1 --memory 2g --memory-swap 2g \
  -p 127.0.0.1:10000:10000 -e SOLO_SESSION_SECRET -e SOLO_PRIVACY_EMAIL -e SOLO_SOURCE_URL doxera-solo:rc1
```

Open localhost on port 10000. The health endpoint is `/health`. Render provides HTTPS for the deployed service. Select `render.solo.yaml` and the `solo-tools` branch when using a Render Blueprint. Set the privacy and source variables to the values above in Render. The Blueprint generates the signing secret. The temporary service storage is private to the running instance. Uploaded files are limited to 50 MB each. Results are streamed once. Normal completion removes the file paths immediately and the orphan sweeper runs before one hour.

## Verify with synthetic documents

The regression fixtures are generated at test time. Make `services/pdf-worker/solo_tests` available read-only as `/qa` to a client container using the release image. Run `python /qa/smoke.py SERVER_ALIAS:10000` with `PYTHONPATH=/app` on an isolated Docker network shared with the server. The script exercises all 28 available downloads and the seven disabled routes. Run the six safeguard tests in a separate container with its own signing secret.

```sh
docker run --rm --network none -e SOLO_SESSION_SECRET -e PYTHONPATH=/app \
  -v "$PWD/services/pdf-worker/solo_tests:/qa:ro" doxera-solo:rc1 \
  python -m unittest discover -s /qa -p test_safeguards.py
```

This tag distributes application and build source. The reviewed Linux/amd64 Docker build used Python 3.11 slim at digest `sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535`. The Dockerfile uses a floating base tag and package repositories. Compare later builds to the tested Python and Debian package inventories. Preserve the application license, contributor credits and third-party notices when redistributing. [Application license](LICENSE) · [Contributors](CONTRIBUTORS.md) · [Third-party notices](NOTICE.md)
