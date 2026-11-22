import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeNames, mergeCalls, definitionLine, mutantsFor } from '../src/analyze.js';
import { own, wrapperSource } from '../src/hooks.mjs';
import { parseArgs, changedFiles, markdown, annotations } from '../src/cli.js';
import { mkdtempSync, writeFileSync, appendFileSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'rubberstamp.js');

function cli(args, cwd) {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT; // set because this file runs under node --test
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('the cart example: exactly the three functions no test checks, and how', () => {
  const r = cli(['--json', '--', process.execPath, '--test'], join(root, 'examples', 'cart'));
  assert.equal(r.code, 1, r.stderr);
  const { functions } = JSON.parse(r.stdout);
  const byName = Object.fromEntries(functions.map((f) => [f.function, f]));
  assert.deepEqual(Object.keys(byName).sort(),
    ['addItem()', 'applyCoupon()', 'formatPrice()', 'formatTotal()', 'saveCart()', 'total()']);
  const survivors = functions.filter((f) => !f.caught).map((f) => [f.function, f.survived]);
  assert.deepEqual(survivors.sort(), [
    ['applyCoupon()', ['returns its first argument unchanged']],
    ['formatPrice()', ['returns undefined', 'returns its first argument unchanged', "returns ''"]],
    ['saveCart()', ['does nothing']],
  ]);
  assert.equal(byName['saveCart()'].at, 'cart.js:21');
  assert.deepEqual(byName['formatPrice()'].calledFrom, ['cart.test.js:25'], 'called through formatTotal');
});

test('CommonJS modules (exports.x = ...) are hollowed out too', () => {
  const r = cli(['--json', '--', process.execPath, '--test'], join(root, 'test', 'fixtures', 'cjs'));
  assert.equal(r.code, 1, r.stderr);
  const { functions } = JSON.parse(r.stdout);
  assert.deepEqual(functions.filter((f) => !f.caught).map((f) => f.function).sort(), ['applyCoupon()', 'formatPrice()', 'saveCart()']);
  assert.equal(functions.find((f) => f.function === 'saveCart()').at, 'cart.js:21');
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('TypeScript modules under Node\'s type stripping', { skip: major < 23 || (major === 23 && minor < 6) ? 'needs Node 23.6+' : false }, () => {
  const r = cli(['--json', '--', process.execPath, '--test', 'math.test.ts'], join(root, 'test', 'fixtures', 'ts'));
  assert.equal(r.code, 1, r.stderr);
  const { functions } = JSON.parse(r.stdout);
  assert.deepEqual(functions.map((f) => [f.function, f.caught, f.at]), [['label()', false, 'math.ts:2'], ['total()', true, 'math.ts:1']]);
});

test('import cycles: a wrapped function can be called before its module has run', () => {
  const r = cli(['--json', '--', process.execPath, '--test', 'x.test.js'], join(root, 'test', 'fixtures', 'cycle'));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).functions.map((f) => [f.function, f.caught]), [['a()', true], ['useB()', true], ['b()', true]]);
});

test('barrel default re-exports, constructors (instanceof) and functions with properties', () => {
  const r = cli(['--json', '--', process.execPath, '--test', 'a.test.js'], join(root, 'test', 'fixtures', 'shapes'));
  assert.equal([0, 1].includes(r.code), true, r.stderr);
  const { functions } = JSON.parse(r.stdout);
  assert.deepEqual(functions.map((f) => f.function).sort(), ['Point()', 'default export', 'memo()']);
  assert.equal(functions.find((f) => f.function === 'memo()').caught, true);
});

test('methods of exported objects and classes (prototype and static)', () => {
  const r = cli(['--json', '--', process.execPath, '--test'], join(root, 'test', 'fixtures', 'members'));
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).functions.map((f) => [f.function, f.at, f.caught]), [
    ['Cart.empty()', 'shop.js:10', true],
    ['Cart#add()', 'shop.js:8', true],
    ['Cart#total()', 'shop.js:9', false],
    ['prices.label()', 'shop.js:3', false],
    ['prices.net()', 'shop.js:2', true],
  ]);
});

test('type-aware hollowing: 0, \'\', [] and constant true/false for functions that return one kind', () => {
  const r = cli(['--json', '--', process.execPath, '--test'], join(root, 'test', 'fixtures', 'kinds'));
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).functions.filter((f) => !f.caught).map((f) => [f.function, f.survived]), [
    ['isAdult()', ['returns its first argument unchanged', 'always returns true']],
    ['tags()', ['returns []']],
  ]);
});

test('promises returned by your code are not observed (a rejection stays unhandled)', () => {
  const r = cli(['--json', '--', process.execPath, 'send.test.js'], join(root, 'test', 'fixtures', 'promise'));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).functions.map((f) => [f.function, f.caught]), [['send()', true]]);
});

test('a suite that fails without rubberstamp is reported, not analysed', () => {
  const r = cli(['--', process.execPath, '-e', 'process.exit(3)'], root);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /fail even without rubberstamp \(exit code 3\)/);
});

test('usage errors exit with 2', () => {
  assert.equal(cli(['--concurrency', '0', '--', 'x'], root).code, 2);
  assert.equal(cli([], root).code, 2);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.deepEqual(parseArgs(['--only', 'src/a', '--', 'npm', 'test']).command, ['npm', 'test']);
});

test('own(): your modules only, not tests, dependencies, or rubberstamp itself', () => {
  const r = 'file:///app/';
  const self = 'file:///app/node_modules/rubberstamp/src/';
  assert.equal(own('file:///app/src/cart.js', r, self), true);
  assert.equal(own('file:///app/src/cart.ts', r, self), true);
  assert.equal(own('file:///app/src/cart.test.js', r, self), false);
  assert.equal(own('file:///app/test/helpers.js', r, self), false);
  assert.equal(own('file:///app/src/__tests__/a.js', r, self), false);
  assert.equal(own('file:///app/node_modules/lodash/index.js', r, self), false);
  assert.equal(own('file:///elsewhere/a.js', r, self), false);
  assert.equal(own('file:///app/src/cart.js?rubberstamp-orig', r, self), false);
  assert.equal(own('file:///app/data.json', r, self), false);
});

test('wrapperSource(): re-exports everything, wraps the named functions, keeps a default', () => {
  const src = wrapperSource('file:///app/a.js', ['total', 'default', 'not-an-identifier'], true);
  assert.match(src, /export \* from "file:\/\/\/app\/a\.js\?rubberstamp-orig";/);
  assert.match(src, /export \{ __rs_0 as total \};\nfunction __rs_0\(\.\.\.args\) \{ return globalThis\.__rubberstamp\.invoke\("file:\/\/\/app\/a\.js", "total", m\["total"\], this, args, new\.target\); \}/);
  assert.match(src, /export \{ __rs_1 as default \};/);
  assert.doesNotMatch(src, /not-an-identifier/);
  assert.match(wrapperSource('file:///app/a.js', [], true), /export default m\.default;/);
  assert.doesNotMatch(wrapperSource('file:///app/a.js', [], false), /default/);
});

test('mergeNames / mergeCalls combine the records of several processes', () => {
  assert.deepEqual(mergeNames([
    { type: 'module', url: 'u', fns: ['a'] }, { type: 'module', url: 'u', fns: ['a', 'b'] }, { type: 'call' },
  ]), { u: ['a', 'b'] });
  const [f] = mergeCalls([
    { type: 'call', url: 'u', name: 'a', calls: 2, async: false, returns: false, maxArgs: 1, sites: ['t.js:1'] },
    { type: 'call', url: 'u', name: 'a', calls: 1, async: true, returns: true, maxArgs: 2, sites: ['t.js:1', 't.js:9'], entry: 't.js' },
  ]);
  assert.deepEqual(f, { url: 'u', name: 'a', calls: 3, async: true, returns: true, maxArgs: 2, kinds: [], sites: ['t.js:1', 't.js:9'], files: ['t.js'], anywhere: true });
});

test('mutantsFor(): type-aware modes only for sync functions that returned a single kind', () => {
  const modes = (f) => mutantsFor({ returns: true, maxArgs: 0, ...f }).map((m) => m.mode);
  assert.deepEqual(modes({ kinds: ['number'] }), ['undefined', 'zero']);
  assert.deepEqual(modes({ kinds: ['boolean'] }), ['undefined', 'true', 'false']);
  assert.deepEqual(modes({ kinds: ['string', 'number'] }), ['undefined']);
  assert.deepEqual(modes({ kinds: ['other'] }), ['undefined']);
  assert.deepEqual(modes({ kinds: ['array'], async: true }), ['undefined']);
});

test('mutantsFor(): identity only for functions that return something and take an argument', () => {
  assert.deepEqual(mutantsFor({ returns: false, maxArgs: 2 }).map((m) => m.mode), ['undefined']);
  assert.deepEqual(mutantsFor({ returns: true, maxArgs: 0 }).map((m) => m.mode), ['undefined']);
  assert.deepEqual(mutantsFor({ returns: true, maxArgs: 1 }).map((m) => m.mode), ['undefined', 'identity']);
});

test('definitionLine() finds function declarations, const arrows, export lists and defaults', () => {
  const src = ['// x', 'export async function load(a) {}', 'export const save = (x) => x;', 'function $q() {}',
    'export { $q as query };', 'export default function () {}'].join('\n');
  assert.equal(definitionLine(src, 'load'), 2);
  assert.equal(definitionLine(src, 'save'), 3);
  assert.equal(definitionLine(src, '$q'), 4);
  assert.equal(definitionLine(src, 'default'), 6);
  assert.equal(definitionLine(src, 'missing'), null);
});

test('changedFiles(): tracked files changed since a ref, as absolute paths; null outside git', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rs-git-')));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'b.js'), 'export const b = 1;\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'init');
  appendFileSync(join(dir, 'b.js'), '// changed\n');
  assert.deepEqual([...changedFiles('HEAD', dir)], [join(dir, 'b.js')]);
  assert.equal(changedFiles('no-such-ref', dir), null);
});

test('markdown(): a table of the rubber-stamped functions, pipes escaped; an all-clear line otherwise', () => {
  const results = [
    { function: 'a()', at: 'src/a.js:3', calledFrom: ['a.test.js:1'], caught: false, survived: ['returns undefined', "returns ''"] },
    { function: 'b|c()', at: 'src/b.js', calledFrom: [], caught: false, survived: ['does nothing'] },
    { function: 'd()', at: 'src/d.js:1', calledFrom: [], caught: true, survived: [] },
  ];
  const md = markdown(results, ['npm', 'test']);
  assert.match(md, /### rubberstamp · `npm test`/);
  assert.match(md, /2 of 3 functions/);
  assert.match(md, /\| `a\(\)` \| `src\/a\.js:3` \| returns undefined, or returns '' \| `a\.test\.js:1` \|/);
  assert.match(md, /`b\\\|c\(\)`/);
  assert.match(md, /_your code_/);
  assert.doesNotMatch(md, /d\(\)/);
  assert.match(markdown([results[2]], ['x']), /All 1 functions are checked/);
});

test('annotations(): a warning per rubber-stamped function, on its line, relative to the workspace', () => {
  const results = [
    { function: 'a()', at: 'src/a.js:3', calledFrom: [], caught: false, survived: ['returns 0', 'returns undefined'] },
    { function: 'b()', at: 'b.js', calledFrom: [], caught: false, survived: ['does nothing'] },
    { function: 'c()', at: 'c.js:1', calledFrom: [], caught: true, survived: [] },
  ];
  const lines = annotations(results, '/repo/pkg', '/repo').trim().split('\n');
  assert.deepEqual(lines, [
    '::warning file=pkg/src/a.js,line=3,title=rubberstamp%3A a() is rubber-stamped::Every test still passes when it returns 0, or when it returns undefined.',
    '::warning file=pkg/b.js,title=rubberstamp%3A b() is rubber-stamped::Every test still passes when it does nothing.',
  ]);
});

test('on GitHub Actions: summary file and annotations; --json stays valid JSON (annotations go to stderr)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-gha-'));
  const summary = join(dir, 'summary.md');
  const env = { ...process.env, NO_COLOR: '1', GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [bin, '--json', '--', process.execPath, '--test'], { cwd: join(root, 'examples', 'cart'), env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(JSON.parse(r.stdout).functions.length, 6);
  assert.match(r.stderr, /^::warning file=.*cart\.js,line=21,title=rubberstamp%3A saveCart\(\) is rubber-stamped::/m);
  assert.match(readFileSync(summary, 'utf8'), /3 of 6 functions can be hollowed out/);
});

test('node:test: a hollow run only runs the test files whose tests call the function', () => {
  const dir = join(root, 'test', 'fixtures', 'files');
  const log = join(mkdtempSync(join(tmpdir(), 'rs-files-')), 'runs.log');
  const run = (extra) => {
    writeFileSync(log, '');
    const env = { ...process.env, NO_COLOR: '1', RS_FIXTURE_LOG: log };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [bin, '--json', '--concurrency', '1', ...extra, '--', process.execPath, '--test'], { cwd: dir, env, encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 1, r.stderr);
    return { functions: JSON.parse(r.stdout).functions.map((f) => [f.function, f.caught]), slowRuns: readFileSync(log, 'utf8').split('\n').filter(Boolean).length };
  };
  const fast = run([]);
  const all = run(['--run-all-files']);
  assert.deepEqual(fast.functions, [['price()', true], ['tax()', false]]);
  assert.deepEqual(all.functions, fast.functions);
  // names + calls + tax()'s hollow runs; price()'s hollow runs skip tax.test.js
  assert.ok(fast.slowRuns < all.slowRuns, `${fast.slowRuns} vs ${all.slowRuns}`);
});

test('entryTestFile(): node:test file processes only; subprocesses inherit their test file', async () => {
  const { createRequire } = await import('node:module');
  const { entryTestFile } = createRequire(import.meta.url)('../src/runtime.cjs');
  const ctx = { NODE_TEST_CONTEXT: 'child-v8' };
  assert.deepEqual(entryTestFile('/app', ctx, '/app/test/a.test.js'), { file: 'test/a.test.js', inherited: false });
  assert.equal(entryTestFile('/app', {}, '/app/test/a.test.js'), null, 'not under node --test');
  assert.equal(entryTestFile('/app', ctx, '/app/test/helpers/server.js'), null, 'a helper script');
  assert.equal(entryTestFile('/app', ctx, '/app/node_modules/x/a.test.js'), null);
  assert.equal(entryTestFile('/app', ctx, '/elsewhere/a.test.js'), null);
  assert.deepEqual(entryTestFile('/app', { ...ctx, RUBBERSTAMP_ENTRY: 'test/e2e.test.js' }, '/app/examples/x.test.js'),
    { file: 'test/e2e.test.js', inherited: true });
});
