# Local CI continuity: verified M1 and M2 staging checkpoint

## M1 — HOST_DOCKER_PASS (owner-provided console evidence, 2026-10-22)

Owner environment: Windows PowerShell, Docker Desktop, checkout under D: drive.
- Branch `feat/local-ci-worker-m1` commit `4b7cf6c4c647c1bb5a6c1770ac3addd8618988c8` pulled fast-forward.
- `node scripts/local-ci.mjs doctor --repo ../project-command-center-ci`: `CI_COMPOSE_CONFIG_PASS`.
- `node scripts/local-ci.mjs run --repo ../project-command-center-ci --profile node-basic`: Docker image `cloudharness-local-ci:node24` built; 4 npm packages installed; syntax check PASS; 21/21 Node tests PASS; `CI_STATUS=PASS`.
- Report path inside container: `/reports/2026-10-22T14-35-40-329Z-e0c36e2015a0-node-basic/report.json`, mapped to operator's persistent host report directory.
- The test used no GitHub Actions. Does **not** prove browser Playwright tests, Go/Android/iOS builds, cache-hit improvement, automatic runner dispatch, or required-check replacement.

## M2 — Host broker prototype, NOT cloud integration acceptance

`scripts/local-ci-broker.mjs` adds an operator-launched HTTP broker:
- Binds `127.0.0.1` only; requires `CI_BROKER_TOKEN` (at least 32 characters), constant-time credential comparison, cache-disabled replies.
- Loads fixed local repository IDs and explicitly allowed profiles from `CI_BROKER_REGISTRY`; does not accept arbitrary paths or commands from requests.
- `POST /v1/ci/runs` with JSON `{"repoId":"demo","profile":"node-basic"}` returns a job ID; `GET /v1/ci/runs/<id>` returns RUNNING/SUCCEEDED/FAILED. One job at a time; process exit code determines status.
- Broker launches the existing host-side Docker CLI script; there is **no new Docker socket mount in an executor**.
- No public port, cross-device endpoint, model credential, or GitHub App permission is authorized.
- **M2 is NOT integrated with CloudHarness Runner / MCP.** Loopback-bound broker is intentionally not accessible from Docker's isolated Runner by default. The next integration requires an operator-reviewed Runner-to-host transport and authenticator, new MCP contract/tests, and Windows host acceptance. Do not quietly relax binding or network policy to make it reachable.
- Job status does not yet contain per-step logs or report retrieval; operator report directory remains authoritative.
- GitHub Actions and branch protections are unchanged; `main` and production were not modified.

## Host setup (operator-only; no production changes)

Create a private JSON registry file outside this repo, for example in your user profile, with the following schema. The path must be a trusted local Git checkout:

```json
{
  "repositories": {
    "command-center": {
      "path": "D:\\build2026\\project-command-center-ci",
      "profiles": ["node-basic"]
    }
  }
}
```

In PowerShell, set a strong random token locally without printing it, set the absolute registry path and run the broker from the CloudHarness checkout:

```powershell
$env:CI_BROKER_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CI_BROKER_REGISTRY = "$HOME\\.cloudharness-local-ci\\repositories.json"
node scripts/local-ci-broker.mjs
```

The broker starts only on loopback at port 4397; remote access and MCP invocation are **not enabled** by these steps. Never commit registry credentials, print tokens, or expose this listener to the internet.

## M2.2 — Runner + MCP integration staged (2026-10-22)

The follow-up branch adds operator-disabled-by-default `ci_run`, `ci_status`, `ci_report` contracts, a Runner-side authenticated bridge, a separate no-published-port Docker-side broker in `compose.ci.integrated.yaml`, and a Runner-only override. The earlier M2 host broker remains available in loopback mode. Code integration is **NOT** equivalent to deployment. See `docs/local-ci-runner-integration.md` for design, security warnings, operator setup and gates. Full typecheck/production verify and Windows Docker/ChatGPT MCP acceptance are still required. GitHub Actions and production remain unchanged.

## Remaining gates

- LOCAL_BROKER_UNIT_TESTS: see run log
- HOST_BROKER_ACCEPTANCE: not yet checked on Windows Docker Desktop
- RUNNER_MCP_CI_TOOLS: not implemented
- REMOTE_RUNNER_TO_HOST_TRANSPORT: not implemented
- GITHUB_ACTIONS_REPLACEMENT: not authorized and not implemented
