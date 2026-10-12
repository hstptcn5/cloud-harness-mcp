# Viewing and importing assets

CloudHarness provides three experimental MCP tools for asset workflows.

**Import** a PNG, JPG, WebP, or ZIP with `asset_import` using canonical base64 content and a workspace-relative target path. SHA-256 may be provided for verification. Files up to 6 MB are supported. This tool does not automatically import ChatGPT attachments: your connected client must provide their bytes. The Workspace → Files tab now includes a local image/ZIP upload form (up to 6 MB, no overwrite). An authenticated dashboard upload endpoint also accepts raw images and ZIPs into an already-open workspace: `POST /dashboard/api/v1/workspaces/:workspaceId/assets/upload?path=assets/image.png`. It requires the browser's authenticated session and CSRF verification; it does not accept anonymous requests.

**View** a workspace image with `image_inspect`. The tool returns size, dimensions, type and hash. For images no larger than 500 KB it can also return native MCP image content to a vision-capable client. Larger supported image files can be converted to a bounded JPEG preview by the executor (the original is not modified). You may set `includeBase64:false` to read metadata without rendering an image.

**Compare** two images with `image_compare`: the result checks dimensions, format and exact file digest equality. This is not an AI evaluation or perceptual similarity measurement.

See `docs/asset-vision.md` in the source repository and `packages/contracts/src/tool-schemas.ts` for canonical parameters and limits. The feature is experimental and needs a rebuilt executor image.
