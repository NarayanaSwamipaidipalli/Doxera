# Doxera Solo

The public Doxera Solo service runs 24 PDF tools without an account. Word, Excel, PowerPoint and HTML imports display Coming soon. Seven earlier catalog entries remain unavailable. Accepted upload types are PDF, PNG, JPEG and WebP. The site describes file handling and lists the operator and privacy contact on its [terms and privacy page](https://doxera-solo.onrender.com/terms-and-privacy).

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
