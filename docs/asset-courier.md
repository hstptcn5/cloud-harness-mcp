# Asset Courier (M1) — source-preserving GitHub Asset Inbox

## Purpose

Asset Courier coordinates user-authorized ChatGPT Image original files into CloudHarness, an isolated GitHub Asset Inbox branch, and a verifiable receipt. It is **not** a new cross-principal file API. A skill cannot grant itself permission to read the ChatGPT conversation storage or `sediment://` pointers.

This implementation is intentionally layered on Draft PR #5 (`feat/chatgpt-fileparams-v067-port`, upstream v0.67.0). That receiving tool is not necessarily installed in the live connector and still requires a **real** ChatGPT-host-provided `openai/fileParams` input. Do not merge or deploy this branch to pretend host acceptance succeeded.

## M1 execution

- **Input:** real PNG/JPEG/WebP originals already imported into an authorized workspace, plus a source manifest with `assets[]: { asset_name, archive_filename, sha256, bytes }`. Each archive filename is relative, e.g. `source_original/maple_staff.png`. Source input must be a directory, not an inaccessible ChatGPT path. A ZIP may be uploaded but must be safely extracted by separately reviewed tooling; Asset Courier does not silently unpack untrusted archives.
- **Gate:** source SHA-256 and size; signature/mime sanity; no traversal, symlink, duplicates, or missing images. No conversion, resampling, aesthetic assessment, ZIP decompression, network fetch or automatic overwrite.
- **Prepare:** `node .agents/skills/asset-courier/scripts/asset-courier.mjs prepare --root INPUT --manifest INPUT/manifest.json --out asset-inbox/BATCH_ID`. A unique destination is required. Files and manifest are copied byte-for-byte. Receipt marks `TRANSPORT_ONLY` and refuses artistic-pass inference.
- **Publish:** CloudHarness Git broker creates a dedicated branch and stages **only** `asset-inbox/BATCH_ID/`, commits and pushes. Do not use repo `main`, change application code, or auto-merge.
- **Independent check:** Open a new workspace at that branch SHA; run `node .agents/skills/asset-courier/scripts/asset-courier.mjs verify --root asset-inbox/BATCH_ID --manifest asset-inbox/BATCH_ID/manifest.json`; compare source and fresh-clone hashes.
- **Handoff:** Only after M1 PASS may an Orion processor run. For Autumn Fantasy choose `illustration`, not pixel art; execution and retained artifact publication are M2, separate from source identity. No auto artistic approval.

## Gate distinctions

| Evidence | Meaning |
| --- | --- |
| Node unit test with generated fixture | ENGINEERING_TEST_ONLY (never M1 acceptance) |
| User dashboard uploaded original | Real bytes accepted, but not zero-click source handoff |
| ChatGPT host fileParams successfully resolved | Receiving tool has a host-provided byte source (requires deployed PR #5) |
| Independent source/CloudHarness/GitHub hash and byte count match | M1 transport source integrity PASS |
| Orion candidate/QA/preview artifacts | M2 downstream evidence; no artistic approval |

Fail statuses: `WAITING_FOR_SOURCE`, `BLOCKED_HOST_FILEPARAMS`, `SOURCE_MISSING`, `HASH_MISMATCH`, `UNSAFE_PATH`, `GITHUB_PUSH_BLOCKED`. Never claim a missing stage succeeded. A stale ChatGPT connector tool list must be refreshed **only after a separately authorized matching API/Runner/executor deployment**; the skill does not deploy services.

## Privacy and reliability

Workspace and GitHub access are owner-bound. GitHub Asset Inbox may be private or public depending on repository visibility: obtain explicit user authorization before pushing images. Never upload signed source download URLs or credentials. The receipt contains only asset names, relative paths, hashes, sizes and transport status. Snapshot result files through CloudHarness retained artifacts before workspace close. Prefer a batch id that cannot collide; fail closed if destination exists.

## M2 (not implemented here)

Use `source_original` immutable copies, per-asset `submit → handoff → process → evaluate`, processor `illustration`, `candidate`, `qa.json`, and preview/contact sheet retained as artifacts. Failures are isolated per asset, but preservation and hashes remain mandatory.
