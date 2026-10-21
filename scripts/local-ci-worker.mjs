import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const profiles = Object.freeze({
  'node-basic': ['npm-ci', 'check', 'test'],
  'node-build': ['npm-ci', 'check', 'test', 'build']
});

export function stepsFor(profile, scripts) {
  if (!(profile in profiles)) throw new Error('Unsupported CI profile: ' + profile);
  if (typeof scripts?.test !== 'string' || !scripts.test.trim()) {
    throw new Error('package.json must declare a test script');
  }
  return profiles[profile].filter(step => step === 'npm-ci' || step === 'test' || typeof scripts[step] === 'string');
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function runCommand(command, args, { cwd, outputFile }) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(outputFile, { flags: 'wx', mode: 0o600 });
    const child = spawn(command, args, {
      cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.on('error', reject);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => {
        log.write(chunk);
        process.stdout.write(chunk);
      });
    }
    child.on('close', (code, signal) => log.end(() => resolve({
      exitCode: code === null ? 1 : code, signal: signal || null
    })));
  });
}

export async function runCI({ root, reportsDir, profile, run = runCommand }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const steps = stepsFor(profile, manifest.scripts);
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const commitResult = await new Promise(resolve => {
    const proc = spawn('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', data => { out += data; });
    proc.on('error', () => resolve(null));
    proc.on('close', code => resolve(code === 0 && /^[a-f0-9]{40,64}$/.test(out.trim()) ? out.trim() : null));
  });
  if (!commitResult) throw new Error('Cannot identify checked-out Git commit');
  const id = stamp + '-' + commitResult.slice(0, 12) + '-' + profile;
  const dir = path.join(reportsDir, id);
  fs.mkdirSync(dir, { recursive: false });
  const report = {
    schema: 'cloudharness-local-ci/v1', profile, commitSha: commitResult,
    startedAt: new Date().toISOString(), status: 'RUNNING', steps: []
  };
  const save = () => {
    const tmp = path.join(dir, 'report.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'report.json'));
  };
  save();
  try {
    for (const [index, step] of steps.entries()) {
      const command = 'npm';
      const args = step === 'npm-ci'
        ? ['ci', '--prefer-offline', '--no-audit', '--no-fund']
        : ['run', step];
      const outputFile = path.join(dir, String(index + 1).padStart(2, '0') + '-' + step + '.log');
      const startedAt = new Date().toISOString();
      let outcome;
      try {
        outcome = await run(command, args, { cwd: root, outputFile });
      } catch (error) {
        fs.writeFileSync(outputFile, String(error?.message || error) + '\n', { flag: 'a' });
        outcome = { exitCode: 1, signal: null };
      }
      const stepResult = {
        name: step, command: [command, ...args], startedAt, finishedAt: new Date().toISOString(),
        exitCode: outcome.exitCode, status: outcome.exitCode === 0 ? 'PASS' : 'FAIL',
        logFile: path.basename(outputFile),
        logSha256: sha256(fs.readFileSync(outputFile))
      };
      report.steps.push(stepResult);
      if (outcome.exitCode !== 0) {
        report.status = 'FAIL';
        break;
      }
      save();
    }
    if (report.status === 'RUNNING') report.status = 'PASS';
  } catch (error) {
    report.status = 'ERROR';
    report.error = String(error?.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
  }
  process.stdout.write('CI_REPORT=' + path.join(dir, 'report.json') + '\n');
  process.stdout.write('CI_STATUS=' + report.status + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv[2] || 'node-basic';
  runCI({ root: '/work', reportsDir: '/reports', profile })
    .then(report => { process.exitCode = report.status === 'PASS' ? 0 : 1; })
    .catch(err => { console.error('CI_WORKER_ERROR:', err.message); process.exitCode = 1; });
}
