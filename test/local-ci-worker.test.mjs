import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stepsFor, runCI } from '../scripts/local-ci-worker.mjs';
import { parseArgs, resolveOptions, dockerArgs } from '../scripts/local-ci.mjs';

test('allowlisted profiles, required test script and optional checks', () => {
  assert.deepEqual(stepsFor('node-basic', { test: 'node --test' }), ['npm-ci', 'test']);
  assert.deepEqual(stepsFor('node-build', { check: 'node --check x.js', test: 'node --test', build: 'vite build' }), ['npm-ci', 'check', 'test', 'build']);
  assert.throws(() => stepsFor('danger', { test: 'test' }), /Unsupported/);
  assert.throws(() => stepsFor('node-basic', {}), /test script/);
});

test('operator launcher rejects unsupported profile and duplicate flag', () => {
  assert.throws(() => parseArgs(['run', '--repo', '.', '--profile', 'shell']), /Invalid profile/);
  assert.throws(() => parseArgs(['run', '--repo', '.', '--repo', '/tmp']), /Duplicate/);
  assert.throws(() => parseArgs(['run', '--profile', 'node-basic']), /repo is required/);
  assert.deepEqual(dockerArgs('run', 'node-basic').slice(-5), ['--rm', '--no-deps', '-T', 'ci-worker', 'node-basic']);
});

test('checkouts must not mix cache or reports with source and avoid path reuse', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-path-'));
  try {
    const repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), '{}');
    fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}');
    const good = resolveOptions({ repo, profile: 'node-basic', cache: path.join(base, 'cache'), reports: path.join(base, 'reports') });
    assert.equal(good.repo, repo);
    assert.throws(() => resolveOptions({ repo, profile: 'node-basic', cache: path.join(repo, 'cache'), reports: path.join(base, 'reports') }), /outside/);
    assert.throws(() => resolveOptions({ repo, profile: 'node-basic', cache: path.join(base, 'cache'), reports: path.join(base, 'cache') }), /separate/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('real Git checkout, mock step execution: PASS and SHA-based log evidence', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-pass-'));
  try {
    const root = path.join(base, 'repo');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', check: 'node --check test.js' } }));
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=ci@example.invalid', '-c', 'user.name=CI Test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
    const steps = [];
    const result = await runCI({ root, reportsDir: path.join(base, 'reports'), profile: 'node-basic', run: async (cmd, args, opts) => {
      fs.writeFileSync(opts.outputFile, args.join(' ') + '\n');
      steps.push(args.join(' '));
      return { exitCode: 0, signal: null };
    } });
    assert.equal(result.status, 'PASS');
    assert.deepEqual(steps, ['ci --prefer-offline --no-audit --no-fund', 'run check', 'run test']);
    assert.ok(result.steps.every(x => x.status === 'PASS' && /^[a-f0-9]{64}$/.test(x.logSha256)));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('actual offline npm ci + npm test runs locally with no GitHub Actions', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-real-'));
  try {
    const root = path.join(base, 'repo');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'local-ci-fixture', version: '1.0.0', scripts: { test: 'node fixture-spec.mjs' }
    }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'local-ci-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: { '': { name: 'local-ci-fixture', version: '1.0.0' } }
    }));
    fs.writeFileSync(path.join(root, 'fixture-spec.mjs'), `import assert from 'node:assert/strict'; assert.equal(1+1,2); console.log('SMOKE_ASSERTION_EXECUTED');`);
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=ci@example.invalid', '-c', 'user.name=CI Test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
    const oldOffline = process.env.npm_config_offline;
    process.env.npm_config_offline = 'true';
    try {
      const result = await runCI({ root, reportsDir: path.join(base, 'reports'), profile: 'node-basic' });
      assert.equal(result.status, 'PASS');
      assert.deepEqual(result.steps.map(x => x.name), ['npm-ci', 'test']);
      assert.ok(result.steps.every(x => x.exitCode === 0));
      const entries = fs.readdirSync(path.join(base, 'reports'));
      const log = fs.readFileSync(path.join(base, 'reports', entries[0], result.steps.at(-1).logFile), 'utf8');
      assert.match(log, /SMOKE_ASSERTION_EXECUTED/);
    } finally {
      if (oldOffline === undefined) delete process.env.npm_config_offline;
      else process.env.npm_config_offline = oldOffline;
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('failed npm command stops the pipeline and records FAIL', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-fail-'));
  try {
    const root = path.join(base, 'repo');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=ci@example.invalid', '-c', 'user.name=CI Test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
    const result = await runCI({ root, reportsDir: path.join(base, 'reports'), profile: 'node-basic', run: async (cmd, args, opts) => {
      fs.writeFileSync(opts.outputFile, 'failed\n');
      return { exitCode: 7, signal: null };
    } });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].exitCode, 7);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
