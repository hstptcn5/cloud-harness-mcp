import express, { type NextFunction, type Request, type Response } from 'express';
import { acceptMcpBodyBytes, MAX_ASSET_MCP_BODY_BYTES } from './mcp-asset-envelope.js';

/**
 * MCP binary asset payloads arrive as base64 inside a standard tools/call JSON-RPC.
 * Keep all ordinary MCP operations at the configured body limit; only the existing
 * owner-authenticated `asset_import` operation gets enough room for a 6 MB PNG.
 *
 * IMPORTANT: This does not grant access to private ChatGPT generated images.
 * The invoking client must have explicit access to the image bytes.
 */
const requestBytes = Symbol('mcpRequestBytes');
type SizedRequest = Request & { [requestBytes]?: number };

/** Parse bounded JSON only AFTER host/origin checks, auth, and per-user limits. */
export function mcpAssetBodyParser(configuredNormalBytes: number) {
  const standardBytes = configuredNormalBytes;
  const parser = express.json({
    strict: true,
    limit: Math.max(standardBytes, MAX_ASSET_MCP_BODY_BYTES),
    verify: (req, _res, buffer) => {
      (req as SizedRequest)[requestBytes] = buffer.length;
    }
  });
  return [
    parser,
    (request: Request, response: Response, next: NextFunction): void => {
      if (!acceptMcpBodyBytes(request.body,
        (request as SizedRequest)[requestBytes] ?? 0, standardBytes)) {
        response.status(413).json({ error: 'request_too_large' });
        return;
      }
      next();
    }
  ];
}
