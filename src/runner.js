// Runs the user's test command once in a given phase and collects the records it wrote.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REGISTER = pathToFileURL(fileURLToPath(new URL('./register.mjs', import.meta.url))).href;
const POSIX = process.platform !== 'win32';

// The command runs in its own process group, so a timeout can kill npm *and* the test runner it
// started. Being in its own group, it no longer gets the terminal's Ctrl+C, so we pass that on.
const running = new Set();
function killGroup(child) {
  try {
    if (POSIX) process.kill(-child.pid, 'SIGKILL');
    else spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
}
let handlersInstalled = false;
function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
    process.on(sig, () => {
      for (const child of running) killGroup(child);
      process.exit(128 + n);
    });
  }
  process.on('exit', () => { for (const child of running) killGroup(child); });
}

/**
 * @param {string[]} command  argv of the test command, e.g. ['npm', 'test']
 * @param {object} o
 * @param {'names'|'calls'|'mutant'} o.phase
 * @param {string} o.root           project directory (whose modules count as "yours")
 * @param {string} [o.namesFile]    JSON { moduleUrl: [function names] } from the names phase
 * @param {string} [o.target]       JSON { url, name, async, mode } for the mutant phase
 * @param {number} [o.timeout]      ms, 0 = none
 */
export async function runOnce(command, o) {
  const dir = mkdtempSync(join(tmpdir(), 'rubberstamp-'));
  const out = join(dir, 'records.jsonl');
  const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
  // Set when rubberstamp itself runs under node --test; it would turn the inner runner into a child reporter.
  delete env.NODE_TEST_CONTEXT;
  env.RUBBERSTAMP_PHASE = o.phase;
  // vitest 5's on-disk module cache would hand one phase's wrappers to the next run.
  env.VITEST_FS_MODULE_CACHE = '0';
  env.RUBBERSTAMP_ROOT = o.root;
  env.RUBBERSTAMP_OUT = out;
  if (o.namesFile) env.RUBBERSTAMP_NAMES = o.namesFile;
  if (o.target) env.RUBBERSTAMP_TARGET = o.target;
  else delete env.RUBBERSTAMP_TARGET;
  // Every Node process the command starts (npm, the runner, its workers) loads the preload.
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import ${REGISTER}`.trim();

  installHandlers();
  const started = Date.now();
  let output = '';
  let timedOut = false;
  const code = await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: o.root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !POSIX,
      detached: POSIX,
    });
    if (child.pid) running.add(child);
    let timer;
    if (o.timeout) {
      timer = setTimeout(() => { timedOut = true; killGroup(child); }, o.timeout);
    }
    const take = (d) => { output = (output + d).slice(-20000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => { output += `\n[rubberstamp] could not start ${command[0]}: ${e.message}\n`; });
    child.on('close', (c, signal) => { clearTimeout(timer); running.delete(child); resolve(c ?? (signal ? 128 : 1)); });
  });

  const records = existsSync(out)
    ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  rmSync(dir, { recursive: true, force: true });
  return { code, passed: code === 0 && !timedOut, timedOut, ms: Date.now() - started, output, records };
}
