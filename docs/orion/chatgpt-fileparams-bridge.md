# ChatGPT Image to CloudHarness MCP file bridge (pilot)

## Scope

Adds the tool **orion_import_chat_file** to the CloudHarness MCP API. Its top-level **source_image** input declares **_meta["openai/fileParams"] = ["source_image"]**. The file object requires **download_url** and **file_id**, with optional **mime_type** and **file_name**, following the official OpenAI reference at https://developers.openai.com/plugins/reference#file-apis.

This tool does not generate art and does not automatically approve source images. It accepts an authorized temporary file reference, downloads the original PNG/JPEG/WebP bytes within bounded limits, then calls the existing owner-bound runner **asset_import** operation.

## Workflow when deployed

1. Open the authorized **hstptcn5/spriteforge** workspace on the audited Orion pilot branch and read the **orion-asset** skill.
2. Call **orion_import_chat_file** with that workspaceId, a workspace-relative path such as **inbox/ember_dash_original.png**, and one actual ChatGPT file attachment as **source_image**. Supply the independently calculated expectedSha256 when verifying exact original-byte identity.
3. The API performs workspace_status authorization before downloading any bytes. It enforces HTTPS trusted host, no redirects, a 6 MB cap, 15-second timeout, image signature, optional MIME and SHA checks; then uses existing **asset_import**, forcing no-overwrite.
4. Confirm via image_inspect (format, dimensions, SHA-256) and then invoke the locked Orion source intake on that real workspace file.
5. Respect Source Image Gate rejection, semantic human review and PREVIEW_ONLY. Never convert a source that fails visual/background checks into an approved asset by blindly keying magenta.

## Security guarantees and limitations

- Only the OpenAI-controlled **oaiusercontent.com** domain and subdomains are permitted for temporary file downloads. There is no caller-controlled hostname allowlist, URL credentials, non-443 port or redirect following. If an official host uses a different origin, update the allowlist in a separate reviewed change.
- The source file URL (containing temporary access) is not returned or persisted; no raw image bytes are included in tool output. Source file_id is an identifier, not cryptographic proof of ChatGPT generation.
- This tool does not bypass workspace authorization. API checks access before download, then the runner checks owner, workspace path, source signature and SHA before accepting the file.
- The API host must be able to reach the temporary file hostname over HTTPS. The runner network-isolation mode does not change.
- A real ChatGPT fileParams attachment handoff has **NOT** been verified until deployed, reconnected and tested with a genuine image. Some ChatGPT clients may not make generated images available via fileParams; retain the Dashboard file upload as an authorized fallback.
- This pilot does **not** deploy automatically, merge Orion PRs, run image generation, or integrate game assets.

## Tests

- Node 24: **node --test apps/api/test/chat-file-download.node.test.mjs**
- In a workspace with npm dependencies: **npx vitest run apps/api/test/chat-file-import-tool.test.ts**
- Full repo: **npm run typecheck && npm test && npm run build**
- Live acceptance: a real standalone ChatGPT Image PNG transferred by fileParams; source and CloudHarness SHA-256 identical; Orion Source Gate returns grounded report (not a fake technical PASS).
