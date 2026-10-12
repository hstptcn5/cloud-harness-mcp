# Viewing and importing assets

CloudHarness provides three experimental MCP tools for asset workflows.

**Import** a PNG, JPG, WebP, or ZIP with `asset_import` using canonical base64 content and a workspace-relative target path. SHA-256 may be provided for verification. Files up to 6 MB are supported. This tool does not automatically import ChatGPT attachments: your connected client must provide their bytes.

**View** a workspace image with `image_inspect`. The tool returns size, dimensions, type and hash. For images no larger than 500 KB it can also return native MCP image content to a vision-capable client. Larger files can be inspected as metadata only (`includeBase64: false`); prepare a smaller preview to see them.

**Compare** two images with `image_compare`: the result checks dimensions, format and exact file digest equality. This is not an AI evaluation or perceptual similarity measurement.

See `docs/asset-vision.md` in the source repository and `packages/contracts/src/tool-schemas.ts` for canonical parameters and limits. The feature is experimental and needs a rebuilt executor image.
