import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mcpAssetBodyParser } from '../src/mcp-asset-body.js';

const standardLimit = 256;
let server: Server;
let url: string;

beforeEach(async () => {
  const app = express();
  // Isolated middleware test: the actual API mounts this AFTER authentication.
  app.use(...mcpAssetBodyParser(standardLimit));
  app.post('/mcp', (request, response) => response.json({ size: JSON.stringify(request.body).length }));
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next; // Express recognizes this as error middleware only with four parameters.
    res.status(error.status ?? 500).json({ error: 'parser_error' });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  url = `http://127.0.0.1:${address.port}/mcp`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (payload: unknown) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload)
});

const tool = (name: string) => ({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name, arguments: { path: 'assets/generated.png', kind: 'png', contentBase64: 'A'.repeat(700) } }
});

describe('large MCP image import body guard', () => {
  it('accepts a valid asset_import envelope above the normal JSON body limit', async () => {
    const response = await post(tool('asset_import'));
    expect(response.status).toBe(200);
    expect((await response.json()).size).toBeGreaterThan(standardLimit);
  });

  it('keeps unrelated MCP operations at the configured normal limit', async () => {
    const response = await post(tool('exec_run'));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'request_too_large' });
  });

  it('rejects an oversized spoofed tool call and batch payload', async () => {
    const named = tool('asset_import');
    const response = await post({ ...named, method: 'resources/read' });
    expect(response.status).toBe(413);
    const batch = await post([named]);
    expect(batch.status).toBe(413);
  });

  it('rejects oversized asset_import envelopes without an actual byte payload', async () => {
    const outer = tool('asset_import');
    const response = await post({
      ...outer, params: { name: 'asset_import', arguments: { path: 'x.png', kind: 'png', useless: 'A'.repeat(700) } }
    });
    expect(response.status).toBe(413);
  });

  it('accepts ordinary JSON-RPC payloads below the configured cap', async () => {
    const response = await post({ jsonrpc: '2.0', method: 'ping', id: 1 });
    expect(response.status).toBe(200);
  });
});
