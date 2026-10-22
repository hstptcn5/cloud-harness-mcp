import { readFileSync } from 'node:fs';
import type { RunnerResponse } from '@cloud-harness/contracts';

type CiAction = 'ci_run' | 'ci_status' | 'ci_report';
type CiInput = Record<string, unknown>;
const TRUSTED_URL = 'http://local-ci-broker:4397';

export class LocalCiBridge {
  private readonly token: string;
  private readonly send: typeof fetch;
  private constructor(token: string, send: typeof fetch) {
    this.token=token;
    this.send=send;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env, send: typeof fetch = fetch): LocalCiBridge | undefined {
    if (env.CI_BROKER_ENABLED !== 'true') {
      if (env.CI_BROKER_ENABLED && env.CI_BROKER_ENABLED !== 'false') throw new Error('CI_BROKER_ENABLED must be true or false');
      return undefined;
    }
    // Pin to an operator-created Docker service on the trusted control network. No user-supplied URL.
    if (env.CI_BROKER_URL !== TRUSTED_URL) throw new Error('CI_BROKER_URL must be the trusted internal service ' + TRUSTED_URL);
    if (!env.CI_BROKER_TOKEN_FILE) throw new Error('CI_BROKER_TOKEN_FILE is required');
    const token = readFileSync(env.CI_BROKER_TOKEN_FILE, 'utf8').trim();
    if (token.length < 32) throw new Error('CI_BROKER_TOKEN_FILE must contain a 32+ character token');
    return new LocalCiBridge(token, send);
  }

  async execute(operation: CiAction, input: CiInput, signal?: AbortSignal): Promise<RunnerResponse> {
    const id = String(input.runId ?? '');
    const route = operation === 'ci_run'
      ? '/v1/ci/runs'
      : '/v1/ci/runs/' + encodeURIComponent(id) + (operation === 'ci_report' ? '/report' : '');
    const body = operation === 'ci_run'
      ? JSON.stringify({repoId:input.repoId, profile:input.profile, idempotencyKey:input.idempotencyKey})
      : undefined;
    let response: Response;
    try {
      response = await this.send(TRUSTED_URL + route, {
        method: operation === 'ci_run' ? 'POST' : 'GET',
        headers: {authorization:'Bearer ' + this.token, ...(body ? {'content-type':'application/json'} : {})},
        ...(body ? {body} : {}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
      });
    } catch {
      return {ok:false, message:'Local CI broker unavailable', error:{code:'UNAVAILABLE',message:'Local CI broker unavailable',retryable:true}, truncated:false};
    }
    let data: unknown;
    try {
      const raw = await response.text();
      if (raw.length > 65_536) throw new Error('response too long');
      data = JSON.parse(raw);
    } catch {
      return {ok:false, message:'Invalid local CI broker response', error:{code:'UNAVAILABLE',message:'Invalid local CI broker response',retryable:true}, truncated:false};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {ok:false, message:'Invalid local CI broker response', error:{code:'UNAVAILABLE',message:'Invalid local CI broker response',retryable:true}, truncated:false};
    }
    if (!response.ok) {
      const error = (data as {error?: unknown}).error;
      const code = typeof error === 'string' && /^[A-Z_]{3,40}$/.test(error) ? error : 'UNAVAILABLE';
      return {ok:false,message:'Local CI rejected operation: ' + code,error:{code:'UNAVAILABLE',message:'Local CI rejected operation: '+code,retryable:response.status>=500},truncated:false};
    }
    return {ok:true,message:operation === 'ci_run'?'Local CI run accepted':'Local CI information',data,truncated:false};
  }
}
