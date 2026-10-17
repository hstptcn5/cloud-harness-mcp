import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import type { RunnerResponse } from '@cloud-harness/contracts';
import type { OperationBackend } from '../src/operation-backend.js';
import { registerChatFileImportTool } from '../src/chat-file-import-tool.js';
import { resultToMcp } from '../src/mcp-server.js';

const tinyPng = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82]);
const sha = createHash('sha256').update(tinyPng).digest('hex');
const sample = {
  workspaceId: 'ws_AWON12etKZnESN-AmS3vO2qP0VI3QOTh',
  path: 'inbox/ember_dash_original.png',
  expectedSha256: sha,
  source_image: {
    file_id: 'file_0000000011111111111',
    download_url: 'https://files.oaiusercontent.com/temporary?secret',
    mime_type: 'image/png',
    file_name: 'ember.png'
  }
};

async function connect(backend: OperationBackend, authenticated = true) {
  const server = new McpServer({ name: 'file-test', version: '1.0.0' });
  let downloaded = 0;
  registerChatFileImportTool(server, backend, {
    resultToMcp,
    download: async () => {
      downloaded++;
      return { bytes: tinyPng, sha256: sha, kind: 'png', mimeType: 'image/png' };
    }
  }, authenticated);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'file-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, downloaded: () => downloaded, close: () => Promise.all([client.close(), server.close()]) };
}

describe('ChatGPT fileParams to bound owner asset_import', () => {
  it('advertises top-level file object and fileParams metadata', async () => {
    const c = await connect({ call: async () => ({ ok: true, message: 'ok', truncated: false }) });
    try {
      const tools = await c.client.listTools();
      const t = tools.tools.find(t => t.name === 'orion_import_chat_file');
      expect(t).toBeDefined();
      expect(t?._meta?.['openai/fileParams']).toEqual(['source_image']);
      const file = (t!.inputSchema.properties!.source_image as { properties: object; required: string[] });
      expect(Object.keys(file.properties)).toEqual(expect.arrayContaining(['file_id','download_url','mime_type','file_name']));
      expect(file.required).toEqual(expect.arrayContaining(['file_id','download_url']));
      expect(file.required).not.toContain('file_name');
    } finally { await c.close(); }
  });

  it('preauthorizes workspace then imports original bytes once with no overwrite', async () => {
    const operations: { op: string; input: Record<string, unknown> }[] = [];
    const backend: OperationBackend = {
      async call(op, input): Promise<RunnerResponse> {
        operations.push({ op, input });
        if(op === 'workspace_status') return { ok:true, message:'ok', truncated:false };
        if(op === 'asset_import') return { ok:true, message:'stored', truncated:false, data: { path: input.path } };
        throw Error('unexpected');
      }
    };
    const c = await connect(backend);
    try {
      const res = await c.client.callTool({ name: 'orion_import_chat_file', arguments: sample });
      expect(res.isError).toBe(false);
      expect(c.downloaded()).toBe(1);
      expect(operations.map(x => x.op)).toEqual(['workspace_status','asset_import']);
      const entry = operations[1]!.input;
      expect(entry.expectedSha256).toBe(sha);
      expect(entry.overwrite).toBe(false);
      expect(entry.path).toBe(sample.path);
      expect(Buffer.from(String(entry.contentBase64),'base64')).toEqual(tinyPng);
      expect(JSON.stringify(res)).not.toContain('temporary?secret');
    } finally { await c.close(); }
  });

  it('denies unauthenticated callers or unauthorized workspace before fetching', async () => {
    let calls = 0;
    const backend: OperationBackend = {
      async call(): Promise<RunnerResponse> {
        calls++;
        return { ok:false,message:'Workspace access denied',error:{code:'FORBIDDEN',message:'Workspace access denied',retryable:false},truncated:false };
      }
    };
    const noAuth=await connect(backend,false);
    try {
      const result=await noAuth.client.callTool({name:'orion_import_chat_file',arguments:sample});
      expect(result.isError).toBe(true);
      expect(calls).toBe(0);
      expect(noAuth.downloaded()).toBe(0);
    } finally {await noAuth.close();}
    const denied=await connect(backend,true);
    try {
      const result=await denied.client.callTool({name:'orion_import_chat_file',arguments:sample});
      expect(result.isError).toBe(true);
      expect(calls).toBe(1);
      expect(denied.downloaded()).toBe(0);
    } finally {await denied.close();}
  });
});
