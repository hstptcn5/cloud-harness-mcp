# Local CI / MCP Runner integration (M2.2, experimental)

The previously verified M1 job ran on the owner's Docker Desktop and returned 21/21 PASS without GitHub Actions. The M2 host broker prototype was implemented separately. **M2.2 is an opt-in integrated Docker-side broker and CloudHarness Runner/MCP contract**, currently awaiting full TypeScript build, Docker integration and owner-side acceptance.

## What is implemented

- `ci_run({repoId, profile, idempotencyKey})`: only allowlisted repository IDs and Node profiles `node-basic` / `node-build`, no arbitrary path or command argument. Returns UUID.
- `ci_status({runId})`: returns RUNNING, SUCCEEDED or FAILED.
- `ci_report({runId})`: bounded structured results (step names, exit codes and SHA-256), no step log bodies or repo paths.
- Runner uses `LocalCiBridge` with fixed URL `http://local-ci-broker:4397`, opt-in `CI_BROKER_ENABLED=true`, and token file; `CI_BROKER_ENABLED` unset is fail-closed. The main API uses its existing principal authorization and authenticated Runner transport.
- `compose.ci.integrated.yaml` creates an isolated CI broker on the existing `cloud-harness-mcp_control` internal network plus an npm egress network. **No exposed host port and no Docker socket in the executor or CI worker.**
- The same worker implementation from M1 runs Node tests with persistent host cache/reports, and the broker permits only one job at once.
- The original operator-only loopback host broker still runs in its own mode; it is not connected to Runner.

## Security and boundaries

**Use only checked-out, trusted private code that you control. Do NOT point this prototype at untrusted fork PRs.** npm install/test scripts execute inside the CI broker container, sharing the container filesystem and process namespace. In particular, the broker token file is mounted in that container and must be treated as potentially readable by untrusted code. This token is limited to this CI broker and MUST NOT be the CloudHarness API token, Runner token or a GitHub credential. Harden job/broker isolation before any public or untrusted CI use.

The broker runs as non-root with bounded CPU/RAM/PIDs, dropped Linux capabilities and read-only root FS, but has writable bind mounts to the selected checkout, npm cache and reports. Use a clean disposable checkout containing **no local credentials or private data**. Do not let untrusted repository code mount the Docker socket or read host paths. Protect report logs (not redacted). Browser tests, full Go/Android builds, iOS/Xcode signing and GitHub required checks are outside M2.2.

The configuration files do not alter the main production Compose by default. Never merge to `main` or update the production runner automatically: that would be a live deployment and requires separate owner authorization.

## Operator review and acceptance plan on Windows (NOT yet executed)

**Do not run these commands until the branch passes `npm ci`, `npm run verify`, Compose config and security review.** Keep existing production deployment unchanged while reviewing. The two optional Compose files deliberately have different purposes and must not be appended to a normal production command by accident.

1. Maintain a dedicated Docker Desktop checkout such as `D:\\build2026\\project-command-center-ci`. M1 already confirmed it runs the Node profile. Make a separate private token file (64+ hex characters) and a `registry-container.json` file outside any Git repo:
   `{"repositories":{"command-center":{"path":"/work","profiles":["node-basic"]}}}`.
2. Ensure `CI_WORKTREE_HOST`, `CI_CACHE_HOST`, `CI_REPORT_HOST`, `CI_BROKER_TOKEN_HOST_FILE` and `CI_BROKER_REGISTRY_HOST_FILE` are absolute host paths pointing to the explicitly selected checkout, its cache/reports, and private files.
3. Validate `docker compose -f compose.ci.integrated.yaml config` and `docker compose -f compose.yaml -f compose.ci.runner.override.yaml config`. Inspect the resulting mount paths, token file exposure, networks, identity, resource constraints and whether the existing CloudHarness Compose project has compatible additional overrides.
4. After successful review: start **only** `ci-broker` in the separate Compose project. Test its internal authenticated API from the trusted control plane. Only then rebuild and redeploy the matching CloudHarness Runner/API with this feature explicitly enabled; ensure token file is mounted only on the runner and CI broker. Test `ci_run`, `ci_status`, `ci_report` from a connected ChatGPT client.
5. Verify replay of the same idempotency key returns the same run, a different payload with the same key is rejected, unauthorized repo/profile returns 403, missing/incorrect broker token is rejected, and deliberately failing tests return FAILED.
6. To disable: remove/disable the CI Runner Compose override and recreate **only** the Runner; stop the `ci-broker` service. Leave the standard CloudHarness Compose services untouched.

## Verification status

- M1 Docker Desktop on Windows: PASS, 21/21 project tests, owner console, 2026-10-22.
- Broker and M2.2 targeted Node tests: PASS as documented in commit test logs.
- TypeScript `npm run verify` including MCP contract tests: **NOT RUN** in isolated network-none workspace without `node_modules`.
- Real Docker integrated broker + Runner + MCP ChatGPT acceptance: **NOT RUN**.
- Production deployment, GitHub Actions changes and branch protection changes: **NOT DONE**.

The acceptance gate is closed until the above missing verification is performed. Do not treat targeted Node tests as production-readiness evidence.
