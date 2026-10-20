# Asset Courier — verified asset handoff

Asset Courier is a repository skill that helps an agent transfer **actual owner-authorized image bytes** through CloudHarness, commit only originals and a hash manifest to a separate GitHub Asset Inbox branch, and re-verify them from a fresh checkout.

It coordinates existing CloudHarness tools; it cannot fetch ChatGPT Image files directly from a chat or `sediment://` pointer. Zero-click delivery requires the separately reviewed ChatGPT `openai/fileParams` receiving tool in Draft PR #5 to be deployed and supplied with real attachments by the ChatGPT host. Until then, upload of the **original PNG file** through the Dashboard is a manual fallback; copied clipboard images might be re-encoded.

The bundled `verify` and `prepare` commands reject missing originals, hash mismatches, symlinks, path traversal, duplicates, and overwriting a batch destination. Only a fresh GitHub clone with matching SHA-256 hashes proves an Asset Inbox transfer succeeded. Tests with image fixtures are engineering checks, not a real ChatGPT Image transfer.

M1 covers source integrity. Orion-Asset illustration processing, candidates, `qa.json`, contact sheet and retained artifacts are a separate M2 scope. Neither transport nor technical QA constitutes artistic approval.

For maintainers, see the repository's `docs/asset-courier.md` runbook and `.agents/skills/asset-courier/SKILL.md`.
