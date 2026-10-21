# Local CI Worker M1 — operator opt-in

This is a **separate Docker Compose project** (`compose.ci.yaml`) for running Node CI checks on the owner's Docker Desktop/host. It does not modify the CloudHarness API, Runner, executor, production compose, MCP endpoints, GitHub workflows, or credentials. No deployment or GitHub Actions changes are implied by this proposal.

## Contract

- An operator calls `node scripts/local-ci.mjs run --repo PATH --profile node-basic` on the **host** where Docker is available. `doctor` validates Compose configuration before the first run.
- `node-basic` runs dependency installation, optional `npm run check`, and required `npm run test`. `node-build` additionally runs an optional `npm run build`. When `package-lock.json` or `npm-shrinkwrap.json` exists, the installer uses `npm ci --prefer-offline --no-audit --no-fund`. **Without a lockfile** (such as `project-command-center`), it uses `npm install --no-save --no-package-lock --prefer-offline --no-audit --no-fund`, records `UNLOCKED_NPM_INSTALL` and a reproducibility warning, and does not create a lockfile. Only these named profiles are accepted; no arbitrary shell command is passed through Docker Compose.
- CI exits nonzero on failure, stops subsequent steps, and writes `report.json` plus per-step logs with SHA-256 to an operator-owned persistent report folder. Cache persists in `~/.cloudharness-local-ci/cache` on the host; it is never a workspace lease directory.
- The worker mounts only an explicitly chosen trusted checkout, cache and reports. It has no Docker socket, published port, CloudHarness token, GitHub App token, or Runner control-plane mount. Root filesystem is read-only, Linux user 1000, all capabilities dropped, PID/CPU/memory bounded. It has ordinary outbound Docker bridge access to install dependencies. **Do not run third-party/unreviewed repository code or untrusted PRs**: npm installs and test scripts can execute arbitrary code, read checkout contents and send data over the network.
- The host checkout is writable to allow `npm ci`; use a disposable clone or clean worktree. Never point `--repo` at a production working directory with secrets, and do not inject credentials into the container. Logs are not automatically redacted.
- This M1 is **host-launched**, not an MCP tool. CloudHarness `tasks_run` already performs short-lived CI in its isolated executor, but **does not control this persistent-cache CI Worker**. A future control-plane integration requires an explicit, authenticated broker with an allowlisted job contract; do not mount Docker socket inside an executor as a shortcut.

## Windows Docker Desktop walkthrough (PowerShell)

Use a clean, trusted Node repo checkout as the CI target (e.g. `project-command-center`). From the checked-out CloudHarness repository:

```powershell
docker version
node scripts/local-ci.mjs doctor --repo "C:\path\to\project-command-center"
node scripts/local-ci.mjs run --repo "C:\path\to\project-command-center" --profile node-basic
# Optional for a repository with npm run build:
node scripts/local-ci.mjs run --repo "C:\path\to\renyro-website" --profile node-build
```

For Linux, use an absolute path such as `/home/me/projects/project-command-center`. Ensure the mounted directories are writable by UID 1000; on Windows Docker Desktop confirm the checkout drive is file-shared. The Docker image requires its first build to fetch a Node base image and Debian packages; both `npm ci` and lockfile-free `npm install` require package registry access unless cached. Use a project lockfile when you need reproducible CI. The image trusts only `/work` as a Git safe directory for Docker Desktop bind mounts. `network-none` CloudHarness executors will not be able to launch this worker: the command must run on the Docker host.

## Evidence and gates

A successful `docker compose config` checks only YAML interpolation; it is **not** a running-container test. A container build verifies the image, not successful CI. Accept M1 only after a host-side job produces PASS report on a real checkout, an intentionally failing test produces FAIL/nonzero, and rerun demonstrates reuse of the host cache. Until then mark `HOST_DOCKER_ACCEPTANCE_NOT_RUN`.

The GitHub Actions workflows and required branch checks must stay unchanged during M1. Do not disable them based on unit tests of this launcher. iOS signing with Xcode, Android/Go and Docker-in-Docker workflows are out of scope for the Node M1 image. For task automation, use existing CloudHarness managed tasks in the workspace where appropriate.

## Smoke test / teardown

```powershell
# Test the launcher/worker logic without Docker:
node --test test/local-ci-worker.test.mjs
# List the Compose project; it does not start unless explicitly run:
docker compose -f compose.ci.yaml --profile ci ps
```

Each job is `docker compose run --rm`: no persistent daemon/container to stop. Cache and reports are persistent host folders; cleanup is explicit and never runs automatically. If the image/worker is not wanted, remove only the `cloudharness-local-ci:node24` image and the operator-selected cache/report directories, not shared CloudHarness volumes. Do not run `docker system prune` or `docker compose down -v` against production.
