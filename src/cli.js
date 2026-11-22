// `rubberstamp [options] -- <test command>`: hollows out each of your functions in turn and reports
// the ones your tests don't notice.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, isAbsolute } from 'node:path';
import { appendFileSync } from 'node:fs';
import { runOnce } from './runner.js';
import { mergeNames, mergeCalls, mutantsFor, where } from './analyze.js';

const HELP = `rubberstamp: find the functions your tests call but never check

Usage: rubberstamp [options] -- <test command...>

  --concurrency <n>  test runs at the same time (default: half your CPUs)
  --only <text>      only hollow functions in files whose path contains <text>
  --changed <ref>    only hollow functions in files changed since a git ref (e.g. origin/main)
  --timeout <ms>     a run that takes longer counts as caught (default: 5x the normal run, min 10 s)
  --json             print the result as JSON
  --markdown         print the result as a Markdown report (for PR comments)
  -h, --help         this help

On GitHub Actions it also adds the report to the job summary and puts a warning on the line of each
rubber-stamped function, so it shows up in the pull request's diff.

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
  const o = { concurrency: Math.max(1, Math.floor(availableParallelism() / 2)), only: null, changed: null, timeout: null, json: false, markdown: false, help: false };
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
    else if (a === '--changed') o.changed = value();
    else if (a === '--timeout') o.timeout = int();
    else if (a === '--json') o.json = true;
    else if (a === '--markdown') o.markdown = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a} (the test command goes after --)`);
  }
  return { o, command };
}

/** Absolute paths of tracked files changed since `ref` (committed or not), or null if git fails. */
export function changedFiles(ref, cwd) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    const out = execFileSync('git', ['diff', '--name-only', ref, '--'], { cwd, encoding: 'utf8' });
    return new Set(out.split('\n').filter(Boolean).map((f) => join(top, f)));
  } catch {
    return null;
  }
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

/** The report as Markdown: a table of the rubber-stamped functions, or a one-line all-clear. */
export function markdown(results, command) {
  const survivors = results.filter((r) => !r.caught);
  const head = `### rubberstamp · \`${command.join(' ').replace(/`/g, "'")}\`\n\n`;
  if (!results.length) return `${head}The tests don't call any exported function of yours, so there was nothing to hollow out.\n`;
  if (!survivors.length) return `${head}✅ **All ${results.length} functions are checked**: hollowing any of them out fails a test.\n`;
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = survivors.map((r) => `| \`${cell(r.function)}\` | \`${cell(r.at)}\` | ${cell(r.survived.join(', or '))} | ${r.calledFrom.length ? r.calledFrom.map((s) => `\`${cell(s)}\``).join(', ') : '_your code_'} |`);
  const caught = results.length - survivors.length;
  return `${head}❌ **${survivors.length} of ${results.length} functions can be hollowed out and every test still passes**\n\n`
    + `| Function | Defined at | Tests still pass when it… | Called from |\n|---|---|---|---|\n${rows.join('\n')}\n\n`
    + `${caught} caught · ${survivors.length} rubber-stamped · ${Math.round((caught / results.length) * 100)}% of the functions your tests call are really checked.\n`;
}

/** GitHub Actions workflow commands: one warning per rubber-stamped function, on its line. */
export function annotations(results, cwd, workspace = cwd) {
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return results.filter((r) => !r.caught).map((r) => {
    const m = /^(.*?)(?::(\d+))?$/.exec(r.at);
    const file = isAbsolute(m[1]) ? m[1] : relative(workspace, join(cwd, m[1]));
    const where = `file=${prop(file)}${m[2] ? `,line=${m[2]}` : ''}`;
    return `::warning ${where},title=${prop(`rubberstamp: ${r.function} is rubber-stamped`)}::${esc(`Every test still passes when it ${r.survived.join(', or when it ')}.`)}\n`;
  }).join('');
}

function tail(output, n = 25) {
  return output.trimEnd().split('\n').slice(-n).map((l) => `  │ ${l}`).join('\n');
}

export async function main(argv, { out = process.stdout, err = process.stderr, color, cwd = process.cwd(), env = process.env } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { err.write(`rubberstamp: ${e.message}\n\n${HELP}\n`); return 2; }
  const { o, command } = parsed;
  if (o.help) { out.write(`${HELP}\n`); return 0; }
  if (!command.length) { err.write(`rubberstamp: give the test command after --\n\n${HELP}\n`); return 2; }
  const c = painter(color ?? (Boolean(out.isTTY) && !process.env.NO_COLOR));
  const quiet = o.json || o.markdown;
  const say = (s) => { if (!quiet) out.write(s); };
  // On GitHub Actions: the report in the job summary, and a warning on each function's line.
  const publish = (results) => {
    if (env.GITHUB_ACTIONS !== 'true') return;
    if (env.GITHUB_STEP_SUMMARY) {
      try { appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown(results, command)}\n`); } catch {}
    }
    // With --json / --markdown, stdout is the report; the runner reads workflow commands from stderr too.
    (quiet ? err : out).write(annotations(results, cwd, env.GITHUB_WORKSPACE || cwd));
  };

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
    if (o.changed) {
      const changed = changedFiles(o.changed, cwd);
      if (!changed) { err.write(`rubberstamp: git diff against ${o.changed} failed\n`); return 2; }
      called = called.filter((f) => changed.has(fileURLToPath(f.url.split('?')[0])));
    }
    const exported = Object.values(names).reduce((n, l) => n + l.length, 0);
    say(`  ${c('gray', `${Object.keys(names).length} modules, ${exported} exported functions, ${called.length} called by the tests`)}\n`);
    if (!called.length) {
      say(`\n${c('yellow', '!')} The tests don't call any exported function of yours, so there is nothing to hollow out.\n`);
      if (o.json) out.write(`${JSON.stringify({ command, functions: [] }, null, 2)}\n`);
      if (o.markdown) out.write(markdown([], command));
      publish([]);
      return 0;
    }

    // 3. One run per function, with that function hollowed out.
    const timeout = o.timeout ?? Math.max(10_000, base.ms * 5);
    const mutants = called.flatMap((f) => mutantsFor(f).map((m) => ({ f, ...m })));
    let done = 0;
    const progress = () => {
      if (!quiet && out.isTTY) out.write(`\r  hollowing ${done}/${mutants.length}...`);
    };
    progress();
    const runs = await pool(mutants.map((m) => () => runOnce(command, {
      phase: 'mutant', root: cwd, namesFile, timeout,
      target: JSON.stringify({ url: m.f.url, name: m.f.name, async: m.f.async, mode: m.mode }),
    })), o.concurrency, () => { done++; progress(); });
    if (!quiet && out.isTTY) out.write('\r\x1b[K');

    const results = called.map((f) => {
      const mine = mutants.map((m, i) => ({ m, run: runs[i] })).filter((x) => x.m.f === f);
      return {
        function: f.name === 'default' ? 'default export' : `${f.name.replace(/^default([.#])/, 'default export$1')}()`,
        at: where(f.url, f.name, cwd),
        calledFrom: f.sites,
        caught: mine.every((x) => !x.run.passed),
        survived: mine.filter((x) => x.run.passed).map((x) => x.m.says),
      };
    });
    const survivors = results.filter((r) => !r.caught);
    publish(results);

    if (o.markdown) {
      out.write(markdown(results, command));
      return survivors.length ? 1 : 0;
    }
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
      say(`      ${c('red', `tests still pass when it ${r.survived.join(', or when it ')}`)}\n`);
      say(`      ${c('gray', r.calledFrom.length ? `called from ${r.calledFrom.join(', ')}` : 'called by your code (no test file on the stack: a callback or after an await)')}\n`);
    }
    const caught = results.length - survivors.length;
    say(`\n  ${c('green', `${caught} caught`)} ${c('gray', '·')} ${c('red', `${survivors.length} rubber-stamped`)} ${c('gray', `· ${Math.round((caught / results.length) * 100)}% of the functions your tests call are really checked`)}\n`);
    say(`  ${c('gray', 'A rubber-stamped function runs in your tests, but no assertion depends on what it returns or does.')}\n`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
