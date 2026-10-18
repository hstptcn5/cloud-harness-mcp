# Orion M1 + S1 — isolated staging authorization package (NOT deployment authorization)

Source baseline: upstream `59aafb49eed27f7109e795b099d369b1c05af716`; Orion PR #5 `4cb540ac925aa113542861f65331cdb81c4760df`; security PR #6 `7516e9eef959640db1815434061b35569b8f599f`; previous candidate PR #7 `eb348c50ca36d4bcca8f986d10f7456d6fc2c7c6`. This branch inherits the exact combined candidate and contains staging-only release evidence. **Never use fork main. Never deploy PR #7 directly.**

## Parity
All S1-final Git blobs match PR #7 except `apps/api/src/mcp-server.ts`, which adds the Orion chat-file import registration and guards registration by authenticated principal. There are no missing S1 security controls; the effective S1 `package-lock.json` blob is identical. The additional staging files are not changes to Orion functionality.

## Staging Compose — standalone ONLY
`staging/compose.orion-m1-agentless.yaml` MUST be the **single** Compose input; never overlay it on `compose.yaml` or `compose.production.yaml`. Neither a shared `.env` nor `env_file` is imported. Services: API, Runner, loopback ingress. No model-gateway, Agent runtime, agent-image, agent-image-keepalive or `AGENT_*` injection. Model-gateway and agent image must NOT be prebuilt in the staging stack. Existing MCP `agent_spawn` tools remain discoverable in the common tool schema but the effective Runner config yields `config.agents===undefined`; `WorkspaceService` returns `UNAVAILABLE` for agent operations before calling any AgentManager or Docker agent launch. Run `node staging/verify-agentless-preflight.mjs` after contract/Runner build to prove configuration and fail-closed behavior.

Requires **a separate staging host with its own Docker daemon/socket**, not a separate Compose project on a production Docker host. Use dedicated host/VM, firewall, IAM/SSH, certificates, secrets, ingress name and port, scratch directory and quotas. On the standalone staging host the only writable runtime bind roots other than its dedicated Docker socket are under `STAGING_ROOT`; never point this at a live production path. Missing `STAGING_ROOT`, `STAGING_REVISION`, `STAGING_PUBLIC_HOST`, `STAGING_ALLOWED_ORIGIN` or `STAGING_INGRESS_PORT` fails Compose interpolation. Never commit staging bearer/service tokens. Stage secret files `STAGING_ROOT/secrets/owner-token` and `runner-token` (different random 32+ character values; permissions 0600, secrets dir 0700). Verify API/Runner owner-bearer setup independently before considering a ChatGPT staging connector.

## Immutable source and image build matrix
Review the **full 40-character combined candidate SHA** and exact CI run first. The standalone Compose uses tags `orion-m1-s1-api:<SHA>`, `orion-m1-s1-runner:<SHA>`, `orion-m1-s1-executor:<SHA>`. Build from reviewed exact Git commit:
```bash
docker build --label "org.opencontainers.image.revision=$REV" -f docker/api.Dockerfile -t "orion-m1-s1-api:$REV" .
docker build --label "org.opencontainers.image.revision=$REV" -f docker/runner.Dockerfile -t "orion-m1-s1-runner:$REV" .
docker build --label "org.opencontainers.image.revision=$REV" -f docker/executor.Dockerfile -t "orion-m1-s1-executor:$REV" .
docker image inspect "orion-m1-s1-api:$REV" "orion-m1-s1-runner:$REV" "orion-m1-s1-executor:$REV" --format '{{.RepoTags}} {{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```
Build provenance CI builds these exact three (NO Agent), records actual image IDs, and runs online image-specific audits. **Source SHA and image tags alone are NOT immutable binary evidence**: `docker/executor.Dockerfile` installs global `pnpm@latest` and `wrangler@latest` and uses floating external build-stage images. Before release authorization retain content-addressed binary digest / OCI archive, verify SHA256 on the staging host and prohibit opportunistic rebuild/pull. CI image IDs are evidence for that runner, not automatically portable to a future staging host.

## Runtime risk register
The last validated S1 image audit found API **2 Moderate, 0 High/Critical**, Runner **1 Moderate, 0 High/Critical**, Agent **1 Moderate, 2 High, 0 Critical**. At this preflight stage the fresh candidate CI prints **each API/Runner Moderate package/version/GHSA** with exact image scopes. No Moderate may be waived by blanket policy; reviewers must inspect reachable parser/HTTP/MCP code and compensating controls. S1 Agent exceptions remain: nested `undici@8.9.0` (GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3) and `brace-expansion@5.0.9` (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p). Their mitigation is absolute **runtime exclusion**, not a patch: no Agent images, profiles or launch service; fail-closed tests mandatory. Staging with Agent enabled is prohibited.

Executor global npm inventory is separate from `package-lock.json`. Previous S1 inventory: `corepack@0.34.0`, `npm@11.6.1`, `pnpm@12.14.0`, `wrangler@4.151.1`; repeat on the exact candidate image and review advisories separately. An inventory is not a security audit.

## Executor mount and privilege gates
Required `WorkspaceService.createExecutor` hardening: UID/GID 10001, read-only root, `--cap-drop ALL`, `--security-opt no-new-privileges`; `/workspace` exclusive writable bind, separate `/opt/user-tools` and `/var/cache/harness` bind mounts and `/tmp` tmpfs. There MUST be no alternate writable same-mount path outside workspace, including aliased bind mounts. Directory file descriptors block symlink swaps but **not a relocated directory inode**. Do not authorize staging without host Docker namespace inspection:
```bash
docker inspect <staging-executor-container> --format '{{json .HostConfig}}'
docker exec <staging-executor-container> id
docker exec <staging-executor-container> sh -c 'cat /proc/self/mountinfo; findmnt -T /workspace; findmnt -T /tmp; findmnt -T /opt/user-tools; findmnt -T /var/cache/harness'
docker exec <staging-executor-container> sh -c 'stat -c "%n %d %a %u:%g" /workspace /tmp /opt/user-tools /var/cache/harness'
```
Perform an isolated negative `rename` check between ephemeral directories under `/workspace` and each allowed writable external mount; require `EXDEV`, never write a production path. Confirm `CapEff=0000000000000000`, `NoNewPrivs: 1` in `/proc/self/status` and deny any new same-mount alias. These are **after-deployment checks**, not proofs already obtained about a future host.

## Network/credential staging-only checklist
- New isolated host, Docker daemon, network/ingress, distinct DNS + TLS, separately issued staging bearer and Runner service tokens; production credentials, paths, DBs, artifacts, jobs, volumes, tunnel and ports never reused.
- Ingress bound to `127.0.0.1:<STAGING_INGRESS_PORT>` until separately authorized staging TLS edge. API may egress by HTTPS only to approved ChatGPT temporary-file hosts; prohibit redirects to unknown hosts and enforce response 6 MB ceiling. Runner Git egress restricted to approved hosts. Executor workspace profile `network-none`. No Agent/model-gateway/provider egress.
- Check Compose `config --format json` for env injection and mount leak **without displaying secrets**; do not run `docker compose up` under this task.

## Abort and rollback procedure (requires separate rollout approval)
Capture all prior isolated staging image digests and staging-only state backups before start. Abort on any unknown service, Agent tool execution, wrong image ID, insecure workspace mount alias, bearer auth bypass, surprise egress, digest mismatch, source decoder failure, bad retry or missing log trace. Stop **only** the isolated staging stack, revoke staging-only credentials if exposed, restore the previous staging image digests and staging-only state snapshot, verify health and MCP tool listing. Do not run production rollback tools, modify production Docker, or change live ChatGPT connector in this task.

## Genuine ChatGPT Image host acceptance — AFTER separate authorization
1. Obtain a newly generated image inside ChatGPT. The **host**, not a test client, must populate `source_image.file_id` and `source_image.download_url` through `_meta["openai/fileParams"]=["source_image"]` on `orion_import_chat_file`.
2. Authenticate to approved isolated staging MCP; inspect `tools/list` and ensure unauthenticated access fails, and a different owner's workspace cannot import.
3. Import original bytes to one owner-bound workspace, with HTTPS allowlist and size cap unchanged. Never log signed URL/query tokens.
4. Independently hash source original and stored file, verify exact SHA256 and byte count; decode image, run Orion Source Gate **separately**, retry identical file/idempotently, reject conflicting overwrite and foreign-owner attempts.
5. Preserve sanitized evidence, request IDs, artifact checksums and image IDs; only successful real-host transfer advances from `M1 PARTIAL / BLOCKED_HOST_VALIDATION` toward Host PASS.

## Explicit authorization still required
Independent signoff for S1+Orion security and remaining advisory dispositions; approved isolated staging host and Docker mount policy; content-addressed images and separate credentials/ingress/egress; **a new user authorization to build/distribute/start staging**, and separately to configure a *staging-only* ChatGPT connector. Never merge PR #5/#6, deploy production or modify SpriteForge PR #53 under this preflight.
