---
name: asset-courier
description: "Transfer real, owner-authorized ChatGPT Image originals to CloudHarness and GitHub Asset Inbox with SHA-256 receipts and fail-closed provenance; prepare Orion-Asset preview handoff. Use for asset-courier, ChatGPT Image transfer, Asset Inbox, Orion asset intake, and no-manual-download asset workflows."
---

# Asset Courier — verified source transport

**M1 scope: real source bytes → owner-bound workspace → GitHub Asset Inbox → independent SHA-256 receipt.** The connector/server cannot infer or download ChatGPT image bytes from a prompt, image ID, a `sediment://` pointer, or a model-side `/mnt/data` path. An instruction file grants no such permission. This skill does not claim to enable a host feature that is not exposed.

## Required order

1. Confirm the repository, owner permission, requested branch, mode and source names. Open a CloudHarness workspace and read the CloudHarness skill; check the current Git tree is clean. Never begin by changing the production environment.
2. **Source gate:** Prefer the existing `orion_import_chat_file` receiving tool **only when the ChatGPT host actually presents the real fileParam attachment**, with the user-authorized download object and independently known SHA-256. Its `source_image` parameter must be populated by the host; NEVER manufacture a URL, file ID, or base64 string. The receiving tool is in a separate Draft PR and may not be deployed or discoverable. Do not assert availability without `tools/list`.
3. If the host has no image fileParams, accept an already authorized real workspace file via the Dashboard binary upload. This is a **manual fallback, not zero-click success**. The Dashboard file picker preserves original bytes; clipboard copy may re-encode and cannot prove master identity. If neither is accessible, respond `WAITING_FOR_SOURCE`; do not create test images or substitute repository artwork.
4. Inspect source digest/dimensions, check source-side independent SHA-256 and byte count against the receiving receipt. Unchanged bytes prove transport only; not image decoding, aesthetics, or provenance of Image generation.
5. For a batch manifest and real extracted PNG files in the workspace, run the bundled portable verifier from the repository root:

       node .agents/skills/asset-courier/scripts/asset-courier.mjs verify --root <source-folder> --manifest <source-folder>/manifest.json
       node .agents/skills/asset-courier/scripts/asset-courier.mjs prepare --root <source-folder> --manifest <source-folder>/manifest.json --out <new-inbox-folder>

   `prepare` fail-closes on missing/mismatched files, duplicate names, symlinks, paths escaping root and pre-existing destination. It copies original bytes; it never converts to pixel art, recompresses or approves anything. It writes `manifest.json` and `courier-receipt.json`. ZIP bytes are not automatically extracted; do not treat a ZIP filename as proof of extracted images.
6. Stage only the new `asset-inbox/<batch-id>/` folder, commit it to a **dedicated new branch** using CloudHarness Git broker tools, and push only if authorized. Do not use `all: true` or merge/push to default branch. Check the diff lists only original binary files, manifest and receipt.
7. Open a **fresh** workspace at the pushed Asset Inbox commit (not a working tree copy). Run `verify` on the files fetched from GitHub, compare every SHA-256 with the independently recorded source receipt, and record the commit SHA. Reject a mismatch; no partial PASS.
8. After M1 source verification, an independent Orion runner may select `illustration` for painterly work and execute `submit → handoff → process → evaluate` in `PREVIEW_ONLY`. Preserve `source_original`, `candidate`, `qa.json`, visual preview and a retained CloudHarness artifact. **Do not claim M2 or human artistic approval during M1.**

## Acceptance

M1 is `PASS` only with one **new actual ChatGPT Image original**, an authorized byte-bearing input, an independent source SHA-256, the workspace import receipt, a pushed Asset Inbox branch, fresh-clone hash comparison and matching byte counts. Fixture or synthetic PNG tests are `ENGINEERING_TEST_ONLY`. If fileParams is not surfaced, report `BLOCKED_HOST_FILEPARAMS`; if real bytes are unavailable, report `WAITING_FOR_SOURCE`. Other failures: `HASH_MISMATCH`, `UNSAFE_PATH`, `SOURCE_MISSING`, `GITHUB_PUSH_BLOCKED`.

## Security boundaries

Do not access private OpenAI storage by guessed URL, scrape a conversation, expand hostname allowlists, replay expired signed URLs, disable TLS checks, pass secrets through command arguments, or enable arbitrary network egress. No code changes, destructive Git operations, merge or deploy in asset processing mode. A skill can orchestrate the existing authorized tools; changing the receiving host/API requires a separate reviewed and deployed implementation.

See the operator runbook in `docs/asset-courier.md`. That file lives at the repository root; this skill may also be installed in other repositories, so never assume it is present outside this checkout.
