import { describe, expect, it } from 'vitest';
import type { RunnerClient } from '../src/runner-client.js';
import { DownstreamOAuthProvider } from '../src/mcp-gateway/oauth-provider.js';

const issuer = 'https://auth.trusted.example';
const foreign = 'https://auth.foreign.example';
const base = {
  clientInformation: { client_id: 'test-client', client_secret: 'client-secret' },
  tokens: { access_token: 'legacy-secret', refresh_token: 'refresh-secret', token_type: 'Bearer' },
  discoveryState: { authorizationServerUrl: issuer }
};
function provider(grant: Record<string, unknown>, manualClient: { clientId:string,clientSecret:string|null }|null = null) {
  const runner = {
    callInternal: async (operation: string) => {
      if (operation === 'mcp_oauth_grant_load') return {
        ok: true, message: 'loaded', truncated: false,
        data: { grant: { blob: JSON.stringify(grant), generation: 1 } }
      };
      return { ok:true, message:'stub', truncated:false, data:{} };
    }
  } as unknown as RunnerClient;
  return new DownstreamOAuthProvider({
    runner,principal:{kind:'owner',ownerId:'owner'},serverId:'mcps_abcdefghijklmnopqrstuvwx',
    scopes:null,manualClient,redirectUrl:'https://gateway.example/callback',
    clientMetadataUrl:null,mode:'background'
  });
}
describe('S1 OAuth authorization server binding',()=>{
  it('refuses legacy grants without issuer instead of replaying credentials',async()=>{
    const legacy=provider(base);
    expect(await legacy.clientInformation()).toBeUndefined();
    expect(await legacy.tokens()).toBeUndefined();
  });
  it('refuses credentials bound to an unexpected issuer',async()=>{
    const mismatch=provider({
      ...base,
      clientInformation:{...base.clientInformation,issuer:foreign},
      tokens:{...base.tokens,issuer:foreign}
    });
    expect(await mismatch.clientInformation()).toBeUndefined();
    expect(await mismatch.tokens()).toBeUndefined();
  });
  it('permits only matching issuer-bound persisted credentials',async()=>{
    const matching=provider({
      ...base,
      clientInformation:{...base.clientInformation,issuer},
      tokens:{...base.tokens,issuer}
    });
    expect((await matching.clientInformation())?.client_id).toBe('test-client');
    expect((await matching.tokens())?.access_token).toBe('legacy-secret');
  });
  it('does not expose a manually configured client secret before issuer discovery',async()=>{
    const manual=provider({}, {clientId:'fixed-client',clientSecret:'secret'});
    const before=await manual.clientInformation();
    expect(before).toBeUndefined();
    manual.saveDiscoveryState({authorizationServerUrl:issuer} as never);
    const after=await manual.clientInformation();
    expect((after as {issuer?:string}|undefined)?.issuer).toBe(issuer);
  });
});
