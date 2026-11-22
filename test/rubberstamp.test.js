import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeNames, mergeCalls, definitionLine, mutantsFor } from '../src/analyze.js';
import { own, wrapperSource } from '../src/hooks.mjs';
import { parseArgs } from '../src/cli.js';

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
    ['formatPrice()', ['returns undefined', 'returns its first argument unchanged']],
    ['saveCart()', ['does nothing']],
  ]);
  assert.equal(byName['saveCart()'].at, 'cart.js:21');
  assert.deepEqual(byName['formatPrice()'].calledFrom, ['cart.test.js:25'], 'called through formatTotal');
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
  assert.match(src, /export const total = rs \? rs\.wrap\("file:\/\/\/app\/a\.js", "total", m\.total\) : m\.total;/);
  assert.match(src, /export \{ __rs_default as default \};/);
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
    { type: 'call', url: 'u', name: 'a', calls: 1, async: true, returns: true, maxArgs: 2, sites: ['t.js:1', 't.js:9'] },
  ]);
  assert.deepEqual(f, { url: 'u', name: 'a', calls: 3, async: true, returns: true, maxArgs: 2, sites: ['t.js:1', 't.js:9'] });
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
