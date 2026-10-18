# CloudHarness S1 security compatibility — review checklist

Scope: independent security patch on upstream v0.67.0, not an Orion feature change.

## Official advisories / intended controls
- GHSA-f897-62hf-6gxq: pinned MCP server 2.3.1, Node transport 2.1.0; reject JSON-RPC batches over 100 *before* dispatch. HTTP body remains limited by Express and SDK's maxRequestBodySize.
- GHSA-46jr-4wx8-v453: explicitly set maxToolInputElements=10,000 on the primary, gateway and local MCP servers; this bounds total object keys/array elements traversed in one tool call. This is the upstream advisory's example threshold. Existing operation contracts impose lower semantic caps on individual paths and arrays; 10,000 is a compatibility ceiling, not a user quota. Test with >10,000 keys and byte size less than the request body bound.
- GHSA-jm63-cq47-j5jp: use per-request server factories (already established), never share a stateless transport or McpServer across principals.
- GHSA-6qxp-vccf-f47h: client 2.3.1 plus fail-closed handling of stored grant credentials missing/mismatching issuer. These grants need reauthorization. Manual OAuth client secrets are not returned without an expected issuer. Preserve original issuance/scope in the encrypted grant store.
- GHSA-jqcg-44mw-7w3h: override proxy-addr to 2.0.8, preserve Express trust proxy disabled; never derive ownership from caller-controlled forwarding headers.
- API undici is pinned to 7.30.1. **Agent is NOT patched:** `@earendil-works/pi-coding-agent@0.84.2` still installs nested `undici@8.9.0` and `brace-expansion@5.0.9`, despite targeted override experiments (nested resolution, version-specific and fresh-lock recreation). Those overrides were removed rather than misrepresented as mitigation. Agent is not on the Orion M1 file-import route; isolated M1 staging must leave agent features and agent container **disabled** until an independently reviewed compatibility patch resolves both High advisories.

## Audited inventory and disposition
- Before S1: full audit 33 (10 moderate, 21 high, 2 critical); production lock 7 (3 moderate, 3 high, 1 critical). After P0 SDK/proxy/API patches: `npm audit --omit=dev` must be repeated against exact final lock; expected remaining only agent nested Undici and brace-expansion High, subject to online re-verification. Old lock output is not enough to sign off.
- `proxy-addr@2.0.8` fixes GHSA-jqcg-44mw-7w3h on API and Runner. Express `trust proxy=false` is retained; do not rely solely on the configuration as the permanent fix.
- `@modelcontextprotocol/client/server/core@2.3.1`, `@modelcontextprotocol/node@2.1.0` are aligned with 2026-07-28 MCP spec; SDK OAuth issuer protection must be combined with legacy grant reauthorization. Direct API `undici@7.30.1` fixes the High WebSocket/TLS advisories.
- Agent `undici@8.9.0`: GHSA-rfgv-xxqx-mfg5 and GHSA-w293-vg96-wgc3 (patched at 8.10.2); nested `brace-expansion@5.0.9`: GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p (patched at 5.0.11/5.0.12). Reachability requires the affected WebSocket/BalancedPool or brace/glob paths; these are *not* called by Orion asset import. This is a compensating **scope isolation** only, not a claim that production Agent is secure.

## Isolation and rollback
- Docker executor must remain UID/GID 10001, --read-only root, --cap-drop ALL, no-new-privileges; /workspace writable isolated bind mount; /tmp separate tmpfs; /opt/user-tools and /var/cache/harness separate bind mounts. Directory FD pinning prevents final/ancestor symlink traversal but **not relocation of already opened inode** into a writable path outside /workspace on the *same mount*. Staging needs explicit negative test for writable same-mount alias. An additional mount invalidates the assumption.
- Existing executor image installs tools globally; enumerate actual versions via `npm ls --global --depth=0 --json` and compare separately against advisories (not covered by repository lockfile audit).
- This branch must never be deployed directly. Preserve previous immutable API, Runner, Agent and executor image IDs before an *authorized* isolated staging test. Roll back them as a unit.

## Evidence gates
- Exact package lock SHA, `npm ci`, runtime npm audit full/omit-dev and per-image **post-prune** audits.
- MCP 100/101, argument element and HTTP body caps, authenticated vs anonymous clients, no dispatch on rejected batch, OAuth issuer reauthorization.
- Full Quality and Docker CI.
- An ephemeral integration branch from Orion PR #5 HEAD, with S1 changes overlaid but without mutating either PR, must pass transport/fileParams hash and owner-bound acceptance.
- No M1 host PASS until a *new original ChatGPT Image* arrives via genuine host fileParams and the source/sink bytes match.
