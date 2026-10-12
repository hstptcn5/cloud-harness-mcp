# Asset Bridge and image inspection (experimental)

The canonical tool contracts are in `packages/contracts/src/tool-schemas.ts`. The execution implementation is `worker/asset-vision.mjs`, dispatched through `worker/harness-worker.mjs`, running in the same constrained executor as other workspace file operations.

## Tools

- `asset_import`: import base64-encoded PNG, JPEG, WebP, or ZIP into an owner-bound workspace. Input is `{workspaceId, path, kind, contentBase64, expectedSha256?, overwrite?}`. Maximum decoded payload is 6,000,000 bytes, with a request limit of 8,000,000 base64 characters. Validates canonical base64, magic header, extension, optional SHA-256, and workspace-confined path. Does **not** extract ZIP, execute data, or auto-commit imported files.
- `image_inspect`: inspect a workspace PNG/JPEG/WebP (`path`, optional `includeBase64`, default true). Returns format, width, height, SHA-256, size. For images at most 500,000 bytes, emits an MCP image content block so a vision-capable client can see it. For larger images use `includeBase64:false` to retrieve metadata; optimize a review copy in the project first.
- `image_compare`: compares two workspace images by format, dimensions, and SHA-256, reporting exact equality. This is **not** a perceptual image difference, semantic visual judgment, or a generative-model evaluation.

## Security boundaries

Tools require the same authenticated workspace ownership and lease enforcement as other MCP operations. Import writes an untrusted binary file only to workspace-relative paths; no arbitrary URL downloads, remote fetching, or ChatGPT attachment access are implied. User-supplied images remain untrusted and should never be executed. The ZIP signature does not validate every archive entry; any later extraction must separately enforce bomb, entry-count, symlink, zip-slip and uncompressed-byte limits.

No secrets are needed or exposed by these tools. They do not deploy code, install model providers, grant file access to other clients, or give CloudHarness automatic access to private ChatGPT assets. The native image result uses the connected client's vision capabilities; CloudHarness itself does not run an external vision model.

## Development

Run `node --test worker/test/asset-vision.test.mjs` for focused worker validation. The executor Dockerfile must install `worker/asset-vision.mjs` beside `harness-worker.mjs`. Run `npm run verify`, Docker tests, and MCP end-to-end tests on a machine with working dependencies/Docker before deployment. These tools are experimental until those gates are green.
