import express, { type NextFunction, type Request, type Response } from 'express';

/**
 * MCP binary asset payloads arrive as base64 inside a standard tools/call JSON-RPC.
 * Keep all ordinary MCP operations at the configured body limit; only the existing
 * owner-authenticated `asset_import` operation gets enough room for a 6 MB PNG.
 *
 * IMPORTANT: This does not grant access to private ChatGPT generated images.
 * The invoking client must have explicit access to the image bytes.
 */
export const MAX_ASSET_MCP_BODY_BYTES = 8_400_000;
const requestBytes = Symbol('mcpRequestBytes');

type SizedRequest = Request & { [requestBytes]?: number };

function isAssetImportCall(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (record.jsonrpc !== '2.0' || record.method !== 'tools/call') return false;
  const params = record.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const fields = params as Record<string, unknown>;
  if (fields.name !== 'asset_import') return false;
  const args = fields.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const input = args as Record<string, unknown>;
  // Let the operation schema perform all file-format, hash, size and path checks.
  return typeof input.contentBase64 === 'string' && typeof input.path === 'string'
    && ['png', 'jpeg', 'webp', 'zip'].includes(String(input.kind));
}

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
      if ((request as SizedRequest)[requestBytes] !== undefined
        && (request as SizedRequest)[requestBytes]! > standardBytes
        && !isAssetImportCall(request.body)) {
        response.status(413).json({ error: 'request_too_large' });
        return;
      }
      next();
    }
  ];
}
