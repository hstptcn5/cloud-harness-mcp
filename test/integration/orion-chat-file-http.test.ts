import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApiApp, type ApiRuntime } from '../../apps/api/src/app.js';
import { createRunnerApp } from '../../apps/runner/src/app.js';
import { executeWorkerRequest } from '../../worker/harness-worker.mjs';
import type { ApiConfig, RunnerConfig, RunnerResponse } from '@cloud-harness/contracts';
import type { WorkspaceService } from '../../apps/runner/src/workspace-service.js';

// Real 3x2 RGBA PNG, not a synthetic header-only payload.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGP4L8f1X+SExn85ozv/GXiULP77RVX/P7FlwX8AmioM96e+sV8AAAAASUVORK5CYII=', 'base64');
const digest = createHash('sha256').update(png).digest('hex');
const workspaceId = 'ws_AWON12etKZnESN-AmS3vO2qP0VI3QOTh';
const deniedWorkspace = 'ws_BBBBBBBBBBBBBBBBBBBBBBBBBBB';
const bearer = 'image-bridge-test-owner-bearer-token-123456';
const runnerToken = 'image-bridge-runner-service-token-123456';
let runner: Server;
let api: Server;
let runtime: ApiRuntime;
let endpoint: URL;
let root: string;
let previousRoot: string | undefined;
let oldFetch: typeof fetch;
let fetchedFromHost = 0;
const operations: string[] = [];

async function serve(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('server address missing');
  return address.port;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'orion-route-'));
  previousRoot = process.env.HARNESS_WORKSPACE_ROOT;
  process.env.HARNESS_WORKSPACE_ROOT = root;
  const service = {
    async execute(_principal: unknown, operation: string, input: Record<string, unknown>): Promise<RunnerResponse> {
      operations.push(operation);
      // The real Runner HTTP service authentication and JSON operation schema
      // execute; only WorkspaceService authorization/dispatch is a controlled test seam.
      if (operation === 'workspace_status') {
        if (input.workspaceId !== workspaceId) return { ok:false, message:'Workspace denied', error:{ code:'FORBIDDEN', message:'Workspace denied', retryable:false }, truncated:false };
        return { ok:true, message:'Workspace authorized', data:{ workspaceId }, truncated:false };
      }
      if (operation === 'asset_import') {
        if (input.workspaceId !== workspaceId) return { ok:false, message:'Workspace denied', error:{ code:'FORBIDDEN', message:'Workspace denied', retryable:false }, truncated:false };
        return await executeWorkerRequest('asset_import', input);
      }
      throw Error('Unexpected operation');
    }
  } as unknown as WorkspaceService;
  runner = createServer(createRunnerApp({ serviceToken: runnerToken } as RunnerConfig, service));
  const port = await serve(runner);
  const config = {
    host:'127.0.0.1', port:0, ownerId:'owner', bearerToken:bearer,
    runnerUrl:`http://127.0.0.1:${port}`, runnerToken,
    publicHosts:['127.0.0.1'], allowedOrigins:[], requestTimeoutMs:10000, maxBodyBytes:262144,
    mcpGatewayTimeoutMs:30000, mcpGatewayMaxResponseBytes:262144, mcpGatewayMaxToolsPerServer:500,
    mcpGatewayMaxSchemaBytes:65536, mcpGatewayMaxCatalogBytes:2097152, mcpGatewayMaxTraceRows:20000,
    mcpGatewayMaxConnections:32, mcpGatewayAllowInsecureHttp:false, mcpGatewayAllowPrivateEndpoints:false
  } as ApiConfig;
  runtime = createApiApp(config);
  api = createServer(runtime.app);
  endpoint = new URL(`http://127.0.0.1:${await serve(api)}/mcp`);
  oldFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'files.oaiusercontent.com') {
      fetchedFromHost++;
      return new Response(png, {status:200, headers:{'content-type':'image/png'}});
    }
    return await oldFetch(input, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = oldFetch;
  await runtime?.close();
  await Promise.all([
    new Promise<void>(resolve => api?.close(()=>resolve())),
    new Promise<void>(resolve => runner?.close(()=>resolve()))
  ]);
  if (previousRoot === undefined) delete process.env.HARNESS_WORKSPACE_ROOT;
  else process.env.HARNESS_WORKSPACE_ROOT = previousRoot;
  await rm(root,{recursive:true,force:true});
});

describe('Orion fileParams HTTP path with real filesystem receipt (mocked WorkspaceService and file host)',()=>{
  it('discovers the tool, enforces runner service auth and imports decoded PNG through HTTP into worker',async()=>{
    const unauthorizedRunner=await oldFetch(new URL('/v1/assets/import',`http://127.0.0.1:${(runner.address() as {port:number}).port}`),{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    expect(unauthorizedRunner.status).toBe(401);
    const client=new Client({name:'orion-route-test',version:'1.0.0'});
    await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{headers:{authorization:`Bearer ${bearer}`}}}));
    try {
      const tools=await client.listTools();
      const t=tools.tools.find(x=>x.name==='orion_import_chat_file');
      expect(t?._meta?.['openai/fileParams']).toEqual(['source_image']);
      const args={
        workspaceId,path:'inbox/actual.png',expectedSha256:digest,
        source_image:{file_id:'file_test_original',download_url:'https://files.oaiusercontent.com/temp?redacted',mime_type:'image/png'}
      };
      const first=await client.callTool({name:'orion_import_chat_file',arguments:args});
      expect(first.isError).toBe(false);
      expect(first.structuredContent?.data).toMatchObject({workspaceId,path:args.path,sha256:digest,sizeBytes:png.length,status:'IMPORTED'});
      expect(await readFile(join(root,'inbox/actual.png'))).toEqual(png);
      const repeated=await client.callTool({name:'orion_import_chat_file',arguments:args});
      expect(repeated.structuredContent?.data).toMatchObject({sha256:digest,status:'ALREADY_IMPORTED',alreadyImported:true});
      const priorFetches=fetchedFromHost;
      const rejected=await client.callTool({name:'orion_import_chat_file',arguments:{...args,workspaceId:deniedWorkspace}});
      expect(rejected.isError).toBe(true);
      expect(fetchedFromHost).toBe(priorFetches);
      expect(operations).toEqual(['workspace_status','asset_import','workspace_status','asset_import','workspace_status']);
      expect(JSON.stringify(first)).not.toContain('redacted');
    } finally { await client.close(); }
  });
});
