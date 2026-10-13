/** Pure MCP tool-call policy: shared by request middleware and offline Node.js security tests.
 * Only asset_import may exceed the ordinary authenticated JSON-RPC body budget.
 * Even for asset_import the actual input schema and workspace ownership gate still apply.
 */
export const MAX_ASSET_MCP_BODY_BYTES = 8_400_000;

export function isAssetImportCall(body: unknown): boolean {
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
  // The tool schema checks base64 canonicality, file magic, hash, and workspace path.
  return typeof input.contentBase64 === 'string'
    && input.contentBase64.length >= 4
    && input.contentBase64.length <= 8_000_000
    && typeof input.path === 'string'
    && ['png', 'jpeg', 'webp', 'zip'].includes(String(input.kind));
}

export function acceptMcpBodyBytes(body: unknown, bytes: number, normalLimit: number): boolean {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(normalLimit) || normalLimit < 1) return false;
  if (bytes <= normalLimit) return true;
  return bytes <= Math.max(normalLimit, MAX_ASSET_MCP_BODY_BYTES) && isAssetImportCall(body);
}
