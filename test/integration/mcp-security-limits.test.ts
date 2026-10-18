import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import express from 'express';
import { createApiApp, type ApiRuntime } from '../../apps/api/src/app.js';
import { TOOL_SPECS, type ApiConfig } from '@cloud-harness/contracts';

const token = 'cloud-harness-s1-security-bearer-token-longer-32';
let api: Server;
let runner: Server;
let runtime: ApiRuntime;
let url: string;
let executed = 0;

beforeAll(async () => {
  const runnerApp = express();
  runnerApp.use(express.json());
  runnerApp.post('/v1/operations', (_req, res) => {
    executed += 1;
    res.json({ ok:true, message:'Security test operation', data:{ accepted:true }, truncated:false });
  });
  runnerApp.get('/healthz', (_req, res)=>res.json({status:'ok'}));
  runner = createServer(runnerApp);
  await new Promise<void>(resolve=>runner.listen(0,'127.0.0.1',resolve));
  const port = (runner.address() as {port:number}).port;
  const config: ApiConfig = {
    host:'127.0.0.1',port:0,ownerId:'owner',bearerToken:token,
    runnerUrl:`http://127.0.0.1:${port}`,runnerToken:'security-test-runner-token-longer-than-32',
    publicHosts:['127.0.0.1'],allowedOrigins:[],requestTimeoutMs:5000,maxBodyBytes:262_144,
    mcpGatewayTimeoutMs:30_000,mcpGatewayMaxResponseBytes:262_144,mcpGatewayMaxToolsPerServer:500,
    mcpGatewayMaxSchemaBytes:65_536,mcpGatewayMaxCatalogBytes:2_097_152,mcpGatewayMaxTraceRows:20_000,
    mcpGatewayMaxConnections:32,mcpGatewayAllowInsecureHttp:false,mcpGatewayAllowPrivateEndpoints:false
  };
  runtime=createApiApp(config);
  api=createServer(runtime.app);
  await new Promise<void>(resolve=>api.listen(0,'127.0.0.1',resolve));
  url=`http://127.0.0.1:${(api.address() as {port:number}).port}/mcp`;
});
afterAll(async()=>{
  await runtime?.close();
  await Promise.all([
    new Promise<void>(resolve=>api?.close(()=>resolve())),
    new Promise<void>(resolve=>runner?.close(()=>resolve()))
  ]);
});

const ping=(id:number)=>({jsonrpc:'2.0',id,method:'ping',params:{}});
const headers={
  'authorization':`Bearer ${token}`,
  'content-type':'application/json',
  'accept':'application/json, text/event-stream',
  'mcp-protocol-version':'2025-11-25'
};
async function send(body:unknown, authenticated=true) {
  return fetch(url,{method:'POST',
    headers:authenticated?headers:{...headers,authorization:''},
    body:JSON.stringify(body),signal:AbortSignal.timeout(8_000)
  });
}
describe('MCP v2.3 security boundaries',()=>{
  it('keeps per-request server isolation and authenticated tool discovery',async()=>{
    const client=new Client({name:'s1-interop',version:'1.0.0'});
    await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{authorization:`Bearer ${token}`}}}));
    try {expect((await client.listTools()).tools).toHaveLength(TOOL_SPECS.length);}
    finally {await client.close();}
    const unauthorized=await send(ping(2),false);
    expect(unauthorized.status).toBe(401);
  });
  it('supports exactly 100 small JSON-RPC messages and rejects 101 before any tool side effects',async()=>{
    const hundred=await send(Array.from({length:100},(_,i)=>ping(i+1)));
    expect(hundred.status).toBe(200);
    const baseline=executed;
    const calls=Array.from({length:101},(_,i)=>({
      jsonrpc:'2.0',id:i+1,method:'tools/call',
      params:{name:'workspace_list',arguments:{}}
    }));
    const rejected=await send(calls);
    expect(rejected.status).toBe(400);
    expect(executed).toBe(baseline);
  });
  it('rejects excessive tool argument object keys using maxToolInputElements',async()=>{
    const baseline=executed;
    const args=Object.fromEntries(Array.from({length:10_050},(_,i)=>['key_'+i, i]));
    const result=await send({jsonrpc:'2.0',id:999,method:'tools/call',params:{name:'workspace_list',arguments:args}});
    const body=await result.text();
    expect(result.status).toBeLessThan(500);
    expect(body).toMatch(/error|exceed|limit/i);
    expect(executed).toBe(baseline);
  });
  it('rejects body larger than the independent 256 KiB Express limit',async()=>{
    const oversized=await send({
      jsonrpc:'2.0',id:1000,method:'ping',
      params:{padding:'x'.repeat(264_000)}
    });
    expect(oversized.status).toBe(413);
  });
});
