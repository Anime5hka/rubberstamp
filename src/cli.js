// `rubberstamp [options] -- <test command>`: hollows out each of your functions in turn and reports
// the ones your tests don't notice.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';
import { runOnce } from './runner.js';
import { mergeNames, mergeCalls, mutantsFor, where } from './analyze.js';

const HELP = `rubberstamp: find the functions your tests call but never check

Usage: rubberstamp [options] -- <test command...>

  --concurrency <n>  test runs at the same time (default: half your CPUs)
  --only <text>      only hollow functions in files whose path contains <text>
  --timeout <ms>     a run that takes longer counts as caught (default: 5x the normal run, min 10 s)
  --json             print the result as JSON
  -h, --help         this help

For every exported function of yours that the tests call, rubberstamp runs the test command once with
that function hollowed out (it returns undefined without running). If the tests still pass, nothing
checks what that function does.

Examples:
  npx rubberstamp -- node --test
  npx rubberstamp --only src/cart -- npx mocha`;

export function parseArgs(argv) {
  const dash = argv.indexOf('--');
  const own = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? [] : argv.slice(dash + 1);
  const o = { concurrency: Math.max(1, Math.floor(availableParallelism() / 2)), only: null, timeout: null, json: false, help: false };
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    const value = () => {
      if (i + 1 >= own.length) throw new Error(`${a} needs a value`);
      return own[++i];
    };
    const int = () => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new Error(`${a} needs a positive whole number`);
      return n;
    };
    if (a === '--concurrency') o.concurrency = int();
    else if (a === '--only') o.only = value();
    else if (a === '--timeout') o.timeout = int();
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a} (the test command goes after --)`);
  }
  return { o, command };
}

const CODES = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 };
const painter = (on) => (style, s) => (on ? `\x1b[${CODES[style]}m${s}\x1b[0m` : s);

/** Runs `jobs` with at most `n` at a time, calling `onDone` as each finishes. */
async function pool(jobs, n, onDone) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
      onDone?.(i, results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return results;
}

function tail(output, n = 25) {
  return output.trimEnd().split('\n').slice(-n).map((l) => `  │ ${l}`).join('\n');
}

export async function main(argv, { out = process.stdout, err = process.stderr, color, cwd = process.cwd() } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { err.write(`rubberstamp: ${e.message}\n\n${HELP}\n`); return 2; }
  const { o, command } = parsed;
  if (o.help) { out.write(`${HELP}\n`); return 0; }
  if (!command.length) { err.write(`rubberstamp: give the test command after --\n\n${HELP}\n`); return 2; }
  const c = painter(color ?? (Boolean(out.isTTY) && !process.env.NO_COLOR));
  const say = (s) => { if (!o.json) out.write(s); };

  say(`${c('bold', 'rubberstamp')} ${c('gray', '·')} ${command.join(' ')}\n\n`);

  // 1. A normal run, which also lists the functions each of your modules exports.
  const base = await runOnce(command, { phase: 'names', root: cwd });
  if (!base.passed) {
    err.write(`${c('red', '✗')} The tests fail even without rubberstamp (exit code ${base.code}). Fix them first.\n${tail(base.output)}\n`);
    return 1;
  }
  const names = mergeNames(base.records);
  const dir = mkdtempSync(join(tmpdir(), 'rubberstamp-'));
  try {
    const namesFile = join(dir, 'names.json');
    writeFileSync(namesFile, JSON.stringify(names));

    // 2. Which of those functions the tests actually call.
    const counted = await runOnce(command, { phase: 'calls', root: cwd, namesFile });
    if (!counted.passed) {
      err.write(`${c('red', '✗')} The tests fail when rubberstamp only watches the calls (exit code ${counted.code}). Please report this.\n${tail(counted.output)}\n`);
      return 1;
    }
    let called = mergeCalls(counted.records);
    if (o.only) called = called.filter((f) => f.url.includes(o.only));
    const exported = Object.values(names).reduce((n, l) => n + l.length, 0);
    say(`  ${c('gray', `${Object.keys(names).length} modules, ${exported} exported functions, ${called.length} called by the tests`)}\n`);
    if (!called.length) {
      say(`\n${c('yellow', '!')} The tests don't call any exported function of yours, so there is nothing to hollow out.\n`);
      if (o.json) out.write(`${JSON.stringify({ command, functions: [] }, null, 2)}\n`);
      return 0;
    }

    // 3. One run per function, with that function hollowed out.
    const timeout = o.timeout ?? Math.max(10_000, base.ms * 5);
    const mutants = called.flatMap((f) => mutantsFor(f).map((m) => ({ f, ...m })));
    let done = 0;
    const progress = () => {
      if (!o.json && out.isTTY) out.write(`\r  hollowing ${done}/${mutants.length}...`);
    };
    progress();
    const runs = await pool(mutants.map((m) => () => runOnce(command, {
      phase: 'mutant', root: cwd, namesFile, timeout,
      target: `${m.f.url}#${m.f.name}#${m.f.async ? 'async' : 'sync'}#${m.mode}`,
    })), o.concurrency, () => { done++; progress(); });
    if (!o.json && out.isTTY) out.write('\r\x1b[K');

    const results = called.map((f) => {
      const mine = mutants.map((m, i) => ({ m, run: runs[i] })).filter((x) => x.m.f === f);
      return {
        function: f.name === 'default' ? 'default export' : `${f.name}()`,
        at: where(f.url, f.name, cwd),
        calls: f.calls,
        calledFrom: f.sites,
        caught: mine.every((x) => !x.run.passed),
        survived: mine.filter((x) => x.run.passed).map((x) => x.m.says),
      };
    });
    const survivors = results.filter((r) => !r.caught);

    if (o.json) {
      out.write(`${JSON.stringify({ command, functions: results }, null, 2)}\n`);
      return survivors.length ? 1 : 0;
    }

    if (!survivors.length) {
      say(`\n${c('green', '✓')} ${c('bold', `All ${results.length} functions are checked`)}: hollowing any of them out fails a test.\n`);
      return 0;
    }
    say(`\n${c('red', '✗')} ${c('bold', `${survivors.length} of ${results.length} functions can be hollowed out and every test still passes`)}\n\n`);
    const width = Math.max(...survivors.map((r) => r.function.length));
    for (const r of survivors) {
      say(`  ${c('bold', r.function.padEnd(width))}  ${c('gray', r.at)}\n`);
      say(`  ${' '.repeat(width)}  ${c('red', `tests still pass when it ${r.survived.join(', or when it ')}`)}\n`);
      if (r.calledFrom.length) say(`  ${' '.repeat(width)}  ${c('gray', `called from ${r.calledFrom.join(', ')}`)}\n`);
    }
    const caught = results.length - survivors.length;
    say(`\n  ${c('green', `${caught} caught`)} ${c('gray', '·')} ${c('red', `${survivors.length} rubber-stamped`)} ${c('gray', `· ${Math.round((caught / results.length) * 100)}% of the functions your tests call are really checked`)}\n`);
    say(`  ${c('gray', 'A rubber-stamped function runs in your tests, but no assertion depends on what it returns or does.')}\n`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
