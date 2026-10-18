# Orion-Asset M1 — fileParams release-readiness handoff

**Scope:** ChatGPT host file input → CloudHarness authenticated API → Runner → executor import receipt. Engineering is separate from host acceptance; **M1 remains PARTIAL / BLOCKED_HOST_VALIDATION**. This document is a staging plan, **not** deployment authorization.

## Reviewed baseline and compatibility

- Fork PR #5 is based on `baseline/upstream-v0.67.0` at `59aafb49eed27f7109e795b099d369b1c05af716`, not the fork's obsolete `main`.
- Pin the **same reviewed commit SHA** in the API image (`cloud-harness-api:local`), Runner image (`cloud-harness-runner:local`) and executor image (`cloud-harness-executor:local`); record actual immutable Docker image IDs and source commit. Rebuilding only API leaves Runner/worker without the matching `asset_import` contract.
- `RunnerClient` routes `asset_import` through `/v1/assets/import`; the Runner HTTP handler requires its service token and admits only this operation on the 9 MB JSON lane; general operations retain their 1 MB body limit. `workspace_status` is checked before downloading, and the import call is pinned to that authorized workspace.
- The executor worker uses Linux `/proc/self/fd` directory handles with `O_DIRECTORY | O_NOFOLLOW` for every parent path. All temporary-write and atomic hardlink operations use the pinned directory, not a re-resolved parent pathname. It fails closed on non-Linux executors.
- Retry of the same contents at the same destination verifies an `O_NOFOLLOW`-opened file descriptor, content hash, size, `mtime`, and the current pathname's device/inode before reporting `ALREADY_IMPORTED`. Distinct bytes and a final symlink are rejected. This verifies the path at the checked instant; user-controlled filesystem mutation **after** the check is not prevented by import.
- Image transport validates the byte digest, size, MIME/magic and bounded source URL, **not complete decoding/artistic quality**. A damaged PNG that passes magic and digest can be stored; an independent PNG decoder/Orion Source Gate must reject it before processing. Never mark transport success as source acceptance.
- `test/integration/orion-chat-file-http.test.ts` exercises MCP SDK → authenticated HTTP API → service-authenticated Runner HTTP → actual executor worker/file receipt with a real 3×2 PNG. **The WorkspaceService dispatch/authorization and host file download are simulated**; production authorization is covered separately by existing runner tests. Do not describe this as unmocked full E2E.

## Staging-only controlled rollout (operator approval required)

1. Record PR head, upstream v0.67 base, CI Quality/Docker success, complete Git diff, original production release SHA, available image IDs and rollback snapshots. Require independent review of filesystem confinement and the host file source contract.
2. Use a **separate staging machine or fully isolated staging Compose project**, with separate credentials, Docker image tags, state/artifact/job roots, mounts, ingress hostname/port, and user accounts. Never point staging at production jobs, volumes, tunnel, nginx or `/etc/cloud-harness-mcp`.
3. At the exact reviewed PR commit, run the same pinned Node/npm and dependency lockfile; build API, Runner and executor images together, then record each `docker image inspect --format '{{.Id}}'` result. Run Node security tests, `npm run verify`, Docker integration and MCP schema discovery against staging only.
4. Start staging Runner and executor image, verify Runner `/healthz` and service-authentication rejection without a token, then staging API. Check authenticated `tools/list` includes `orion_import_chat_file` with `_meta['openai/fileParams']=['source_image']`; confirm anonymous requests cannot import. Validate owner isolation with an unauthorized workspace.
5. Import exactly one owner-authorized **new ChatGPT Image original**, not a fixture, clipboard re-encode, previous six PNGs or fabricated file input. ChatGPT host must supply `source_image.file_id` and `download_url` itself. Confirm allowed hostname and expiry without printing the query string or signed URL; verify outbound DNS/HTTPS egress from staging API to that host. Never weaken redirects/host allowlist just to make the test succeed. A new official host requires separate security review.
6. Compare a source-side independently computed SHA-256 and byte count with the imported filesystem receipt; inspect dimensions with a true decoder, run the downstream Source Gate separately, retry identical content and ensure `ALREADY_IMPORTED`, then assert conflict on different content/same path. Preserve only safe evidence: workspace ID, relative path, digest, byte count, HTTP status/code, request correlation IDs and timestamps. Do not retain signed URLs, bearer tokens or original secret query parameters in logs.
7. Stop before production rollout. Only a new, separate deployment authorization can advance to production. The normal production `cloud-harness-deploy <sha>` script insists on a commit reachable from `origin/main`; **PR #5 is not eligible** and the outdated fork `main` must never be used to bypass the gate.

## Staging rollback / abort

- Abort immediately for unknown file host/redirect, downloader egress failure, wrong bytes/hash, owner-boundary violation, stale tool schema, wrong image revision, unexpected filesystem files, decoder failure, or unhealthy Runner/API.
- Disconnect the staging MCP client, stop only the **staging** Compose project, retain sanitized results and logs, and restore the known-good staged API/Runner/executor image IDs together. Restore staging-only state/artifact snapshot if tests mutated persistent staging data. Verify health and `tools/list` again. Do not mutate production services or copy staging credentials to production.
- When a future **separately authorized production** deployment is considered, the existing root-owned release tooling records prior revision/images/config/state and supplies `/usr/local/sbin/cloud-harness-rollback`, documented in `deploy/scripts/release-runtime.sh` and `deploy/scripts/rollback-release.sh`. Confirm snapshots and runner release image IDs before deploying; active checkout files are not part of release snapshots. No production rollback command was invoked in this work.

## Acceptance evidence classes

| Gate | Required proof |
| --- | --- |
| **ENGINEERING PASS** | Exact reviewed commit, passing targeted security/adversarial/real-PNG tests, TypeScript/lint/build, isolated integration, Docker CI |
| **STAGING PASS** | Matching API/Runner/executor image IDs, staging MCP discovery and auth, owner isolation, actual staging binary receipt and independent SHA; safe rollback rehearsal |
| **HOST PASS** | New ChatGPT Image explicitly delivered through ChatGPT host fileParams, exact source/sink SHA/bytes, safe retry, traceable Orion intake; no fabricated payload or manually attached substitute |

**Current status:** `M1 PARTIAL / BLOCKED_HOST_VALIDATION`. A successful GitHub CI workflow is not staging or host acceptance. No merge, production deployment, connector changes, or SpriteForge PR #53 changes are authorized by this handoff.
