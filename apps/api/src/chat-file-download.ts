import { createHash } from 'node:crypto';

/**
 * ChatGPT fileParams gives the MCP tool a user-authorized *temporary URL*.
 * Never accept a file_id alone, fabricate an endpoint, use runner network access,
 * or follow a redirect to an unchecked destination.
 */
export const MAX_CHAT_IMAGE_BYTES = 6_000_000;
const DEFAULT_HOSTS = ['oaiusercontent.com'];
const SHA256 = /^[a-f0-9]{64}$/;

export type ChatFileImportErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'LIMIT_EXCEEDED' | 'UNAVAILABLE' | 'TIMEOUT';

export class ChatFileImportError extends Error {
  readonly code: ChatFileImportErrorCode;
  constructor(
    code: ChatFileImportErrorCode,
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = 'ChatFileImportError';
  }
}

export type ChatFileReference = {
  download_url: string;
  file_id: string;
  mime_type?: string | undefined;
  file_name?: string | undefined;
};

export type DownloadedChatImage = {
  bytes: Buffer;
  sha256: string;
  kind: 'png' | 'jpeg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
};

/** Host-controlled allowlist; NOT a client-provided list. */
export function allowedFileUrl(raw: string, hosts: readonly string[] = DEFAULT_HOSTS): URL {
  let u: URL;
  try { u = new URL(raw); }
  catch { throw new ChatFileImportError('INVALID_INPUT', 'Invalid temporary file URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')
      || !hosts.some((root) => {
        const domain = root.toLowerCase().replace(/\.$/, '');
        return u.hostname.toLowerCase() === domain || u.hostname.toLowerCase().endsWith('.' + domain);
      })) {
    throw new ChatFileImportError('FORBIDDEN', 'File URL is not an approved ChatGPT file host');
  }
  return u;
}

export function imageKind(data: Uint8Array): DownloadedChatImage['kind'] {
  if (data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpeg';
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
     && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'webp';
  throw new ChatFileImportError('INVALID_INPUT', 'File bytes are not a PNG, JPEG or WebP image');
}

const mimeFor = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;
export async function downloadChatImage(
  ref: ChatFileReference,
  options: {
    expectedSha256?: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    allowedHosts?: readonly string[];
    timeoutMs?: number;
    maxBytes?: number;
  } = {}
): Promise<DownloadedChatImage> {
  if (!ref || typeof ref.file_id !== 'string' || !ref.file_id.length || ref.file_id.length > 300 || [...ref.file_id].some(ch => { const n = ch.charCodeAt(0); return n < 32 || n === 127; })
    || typeof ref.download_url !== 'string' || ref.download_url.length > 8192) {
    throw new ChatFileImportError('INVALID_INPUT', 'Authorized ChatGPT file object with file_id and download_url required');
  }
  if (options.expectedSha256 !== undefined && !SHA256.test(options.expectedSha256)) {
    throw new ChatFileImportError('INVALID_INPUT', 'Expected SHA-256 must be 64 lowercase hexadecimal characters');
  }
  const url = allowedFileUrl(ref.download_url, options.allowedHosts);
  const cap = Math.min(options.maxBytes ?? MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_BYTES);
  const timeoutMs = Math.min(options.timeoutMs ?? 15_000, 30_000);
  // Abort applies even to a response body which stops yielding data.
  const timed = AbortSignal.timeout(timeoutMs);
  const combined = options.signal ? AbortSignal.any([timed, options.signal]) : timed;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal: combined,
      headers: { Accept: 'image/png, image/jpeg, image/webp, application/octet-stream' }
    });
  } catch {
    throw new ChatFileImportError(combined.aborted ? 'TIMEOUT' : 'UNAVAILABLE', 'Unable to retrieve the temporary ChatGPT file');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ChatFileImportError('FORBIDDEN', 'File URL redirects are not allowed');
  }
  if (!response.ok || !response.body) {
    throw new ChatFileImportError('UNAVAILABLE', 'Temporary ChatGPT file is unavailable or expired');
  }
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > cap) {
    await response.body.cancel().catch(() => {});
    throw new ChatFileImportError('LIMIT_EXCEEDED', 'ChatGPT image exceeds the configured upload limit');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try { read = await reader.read(); }
      catch { throw new ChatFileImportError(combined.aborted ? 'TIMEOUT' : 'UNAVAILABLE', 'Unable to read ChatGPT file bytes'); }
      if (read.done) break;
      size += read.value.byteLength;
      if (size > cap) throw new ChatFileImportError('LIMIT_EXCEEDED', 'ChatGPT image exceeds the configured upload limit');
      chunks.push(read.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (size === 0) throw new ChatFileImportError('INVALID_INPUT', 'ChatGPT image is empty');
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
  const kind = imageKind(bytes);
  const mimeType = mimeFor[kind];
  if (ref.mime_type && ref.mime_type !== mimeType) {
    throw new ChatFileImportError('INVALID_INPUT', 'File MIME claim does not match actual image bytes');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (options.expectedSha256 && sha256 !== options.expectedSha256) {
    throw new ChatFileImportError('INVALID_INPUT', 'Original image SHA-256 does not match expected source');
  }
  return { bytes, sha256, kind, mimeType };
}
