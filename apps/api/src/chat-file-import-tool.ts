import { z } from 'zod';
import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import type { RunnerResponse } from '@cloud-harness/contracts';
import { WorkspaceIdSchema, ToolResultSchema } from '@cloud-harness/contracts';
import { ChatFileImportError, downloadChatImage, type DownloadedChatImage, type ChatFileReference } from './chat-file-download.js';
import type { OperationBackend } from './operation-backend.js';

const ChatFileSchema = z.object({
  download_url: z.string().min(1).max(8192),
  file_id: z.string().min(1).max(300),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
}).strict();

const ChatFileToolInput = z.object({
  workspaceId: WorkspaceIdSchema.optional(),
  path: z.string().min(1).max(1024),
  source_image: ChatFileSchema,
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict();

function failure(code: ChatFileImportError['code'], message: string): RunnerResponse {
  return { ok: false, message, error: { code, message, retryable: code === 'UNAVAILABLE' || code === 'TIMEOUT' }, truncated: false };
}

/**
 * API-host boundary: the only outbound request is to a host-validated
 * ChatGPT file URL. The existing runner asset_import enforces owner/workspace
 * authorization, path isolation, signature, SHA-256, and no-overwrite.
 */
export function registerChatFileImportTool(
  server: McpServer,
  backend: OperationBackend,
  dependencies: {
    resultToMcp: (result: RunnerResponse) => CallToolResult;
    download?: (source: ChatFileReference, options: { expectedSha256?: string; signal?: AbortSignal }) => Promise<DownloadedChatImage>;
  },
  authenticated = true
): void {
  const { resultToMcp } = dependencies;
  server.registerTool('orion_import_chat_file', {
    title: 'Import ChatGPT image into an Orion workspace',
    description: 'Import one user-authorized original ChatGPT PNG/JPEG/WebP file into a CloudHarness workspace. Requires a ChatGPT file attachment, not an image URL supplied by the user. Preserves bytes and verifies SHA-256; does not generate or approve art.',
    inputSchema: ChatFileToolInput,
    outputSchema: ToolResultSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: { 'openai/fileParams': ['source_image'] }
  }, async (input, context) => {
    if (!authenticated) return resultToMcp(failure('FORBIDDEN', 'Authenticated CloudHarness connection required'));
    try {
      // Authorize workspace access BEFORE requesting a remote image. The runner
      // evaluates the owner/principal, workspace lifecycle and explicit binding.
      const authorized = await backend.call('workspace_status', input.workspaceId ? { workspaceId: input.workspaceId } : {}, context.mcpReq.signal);
      if (!authorized.ok) return resultToMcp(authorized);
      // Pin the exact owner-authorized workspace before fetching any file bytes.
      // An omitted workspaceId must not resolve to another workspace during import.
      const workspaceId = (authorized.data as { workspaceId?: unknown } | undefined)?.workspaceId;
      if (!WorkspaceIdSchema.safeParse(workspaceId).success ||
          (input.workspaceId && input.workspaceId !== workspaceId)) {
        return resultToMcp(failure('FORBIDDEN', 'Workspace authorization did not resolve to a stable workspace'));
      }
      const image = await (dependencies.download ?? downloadChatImage)(input.source_image, {
        ...(input.expectedSha256 ? { expectedSha256: input.expectedSha256 } : {}),
        ...(context.mcpReq.signal ? { signal: context.mcpReq.signal } : {})
      });
      // No URL or file bytes are returned in MCP output, logs, or job metadata.
      const result = await backend.call('asset_import', {
        workspaceId,
        path: input.path,
        kind: image.kind,
        contentBase64: image.bytes.toString('base64'),
        expectedSha256: image.sha256,
        overwrite: false
      }, context.mcpReq.signal);
      if (!result.ok) return resultToMcp(result);
      return resultToMcp({
        ...result,
        data: {
          workspaceId,
          path: input.path,
          sha256: image.sha256,
          sizeBytes: image.bytes.length,
          mimeType: image.mimeType,
          sourceFileId: input.source_image.file_id,
          creatorVerified: false,
          imported: true,
          alreadyImported: (result.data as { alreadyImported?: unknown } | undefined)?.alreadyImported === true,
          status: (result.data as { alreadyImported?: unknown } | undefined)?.alreadyImported === true ? 'ALREADY_IMPORTED' : 'IMPORTED'
        }
      });
    } catch (err) {
      if (err instanceof ChatFileImportError) return resultToMcp(failure(err.code, err.message));
      return resultToMcp(failure('UNAVAILABLE', 'ChatGPT file import failed; no image was accepted'));
    }
  });
}
