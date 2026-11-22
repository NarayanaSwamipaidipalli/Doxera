# Doxera Solo

This source release runs 24 PDF tools behind an owner-only HTTP Basic gate on a single Linux web service. Word, Excel, PowerPoint and HTML imports display Coming soon. Seven earlier catalog entries remain unavailable. Accepted upload types are PDF, PNG, JPEG and WebP. This release candidate is for synthetic testing while the native parser security review is open.

## Build and run

Run these commands in Bash from the repository root on a machine with Docker. Generate a unique trial password in your password manager.

```sh
docker build --file services/pdf-worker/Dockerfile.solo --tag doxera-solo:rc2 services/pdf-worker
export SOLO_SESSION_SECRET="$(openssl rand -hex 32)"
read -rs -p "Trial password (at least 24 characters): " SOLO_TRIAL_PASSWORD
echo
export SOLO_TRIAL_PASSWORD
export SOLO_PRIVACY_EMAIL='roughnarayana@gmail.com'
export SOLO_SOURCE_URL='https://github.com/NarayanaSwamipaidipalli/Doxera/archive/refs/tags/solo-v1.0.0-rc.2.tar.gz'
docker run --rm --name doxera-solo --cpus 1 --memory 2g --memory-swap 2g \
  -p 127.0.0.1:10000:10000 -e SOLO_TRIAL_PASSWORD -e SOLO_SESSION_SECRET -e SOLO_PRIVACY_EMAIL -e SOLO_SOURCE_URL doxera-solo:rc2
```

Open localhost on port 10000 and sign in as `owner` with your trial password. The health endpoint is `/health`. Render provides HTTPS for the deployed service. Select `render.solo.yaml` and the `solo-tools` branch when using a Render Blueprint. Enter the privacy email and trial password when prompted. The Blueprint sets the source URL and selects trial access. A missing trial password prevents startup. The Blueprint generates the signing secret. The temporary service storage is private to the running instance. Uploaded files are limited to 50 MB each. Results are streamed once. Normal completion removes the file paths immediately and the orphan sweeper runs before one hour.

## Verify with synthetic documents

The regression fixtures are generated at test time. Make `services/pdf-worker/solo_tests` available read-only as `/qa` to a client container using the release image. Pass the trial password via `-e SOLO_TRIAL_PASSWORD` to the client. Run `python /qa/smoke.py SERVER_ALIAS:10000` with `PYTHONPATH=/app` and `SOLO_LOCAL_TEST=1` on an isolated Docker network shared with the server. For a hosted trial, supply the full HTTPS origin and omit the local-test variable. The script exercises all 24 available downloads and eleven disabled routes. Run the nine safeguard tests in a separate container with its own signing secret.

```sh
docker run --rm --network none -e SOLO_TRIAL_PASSWORD -e SOLO_SESSION_SECRET -e PYTHONPATH=/app \
  -v "$PWD/services/pdf-worker/solo_tests:/qa:ro" doxera-solo:rc2 \
  python -m unittest discover -s /qa -p test_safeguards.py
```

This tag distributes application and build source. The reviewed Linux/amd64 Docker build used Python 3.11 slim at digest `sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535`. The Dockerfile uses a floating base tag and package repositories. Compare later builds to the tested Python and Debian package inventories. Preserve the application license, contributor credits and third-party notices when redistributing. [Application license](LICENSE) · [Contributors](CONTRIBUTORS.md) · [Third-party notices](NOTICE.md)

## Office import maintenance

The parser upgrade plan covers Expat, both libxml2 distributions and the conditions for reopening each import route. [Office parser update plan](docs/OFFICE_PARSER_UPDATE.md)
