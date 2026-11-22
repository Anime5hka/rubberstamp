'use strict';
// The part of rubberstamp that runs inside the test process. What it does depends on
// RUBBERSTAMP_PHASE:
//   names   record which exports of each module are plain functions
//   calls   record which of those functions the tests call, and from where
//   mutant  hollow out one function (RUBBERSTAMP_TARGET) and let everything else run as usual
// Everything it learns is appended to RUBBERSTAMP_OUT right away: test workers are often killed
// rather than exited (vitest, jest), and jest loads a fresh copy of this file for every test file.
const { appendFileSync } = require('node:fs');
const { fileURLToPath } = require('node:url');
const { relative } = require('node:path');

const TEST_FILE = /(\.|_|-)(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|[\\/]tests?[\\/]/;
const isClass = (fn) => /^class[\s{]/.test(Function.prototype.toString.call(fn));

function create(env = process.env) {
  const phase = env.RUBBERSTAMP_PHASE;
  const root = env.RUBBERSTAMP_ROOT || process.cwd();
  // url#name#async|sync#undefined|identity
  const [targetUrl, targetName, targetAsync, targetMode] = (env.RUBBERSTAMP_TARGET || '').split('#');

  const records = new Map(); // key -> record
  const put = (key, init) => {
    if (!records.has(key)) records.set(key, init());
    return records.get(key);
  };
  const emit = (rec) => {
    if (!env.RUBBERSTAMP_OUT) return;
    try { appendFileSync(env.RUBBERSTAMP_OUT, `${JSON.stringify(rec)}\n`); } catch {}
  };

  /** file:line of the test code that (directly or through other code) made this call. */
  function testSite() {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 50;
    const stack = new Error().stack;
    Error.stackTraceLimit = limit;
    for (const line of stack.split('\n').slice(2)) {
      const m = /\(?((?:file:\/\/)?\/[^()]*?|[A-Za-z]:\\[^()]*?):(\d+):\d+\)?$/.exec(line.trim());
      if (!m) continue;
      const file = m[1].startsWith('file:') ? fileURLToPath(m[1]) : m[1];
      if (/[\\/]node_modules[\\/]/.test(file) || !TEST_FILE.test(file)) continue;
      return `${relative(root, file)}:${m[2]}`;
    }
    return null;
  }

  function seen(url, m) {
    if (phase !== 'names') return;
    const rec = put(url, () => ({ type: 'module', url, fns: [] }));
    const before = rec.fns.length;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'function' && !isClass(v) && !rec.fns.includes(k)) rec.fns.push(k);
    }
    if (rec.fns.length !== before) emit(rec);
  }

  const hollows = (url, name) => phase === 'mutant' && url === targetUrl && name === targetName;

  /** One call of a wrapped function: hollow, recorded, or just passed through. */
  function invoke(url, name, fn, thisArg, args, newTarget) {
    if (hollows(url, name)) {
      const value = targetMode === 'identity' ? args[0] : undefined;
      return targetAsync === 'async' ? Promise.resolve(value) : value;
    }
    const result = newTarget ? Reflect.construct(fn, args) : Reflect.apply(fn, thisArg, args);
    if (phase === 'calls') record(url, name, args, result);
    return result;
  }

  function record(url, name, args, result) {
    const rec = put(`${url}#${name}`, () => ({ type: 'call', url, name, calls: 0, async: false, returns: false, maxArgs: 0, sites: [] }));
    const { maxArgs, async, returns } = rec;
    const sites = rec.sites.length;
    rec.calls++;
    rec.maxArgs = Math.max(rec.maxArgs, args.length);
    if (result && typeof result.then === 'function') {
      rec.async = true;
      result.then((v) => { if (v !== undefined && !rec.returns) { rec.returns = true; emit({ ...rec, calls: 0 }); } }, () => {});
    } else if (result !== undefined) rec.returns = true;
    if (rec.calls <= 50) {
      const site = testSite();
      if (site && !rec.sites.includes(site) && rec.sites.length < 5) rec.sites.push(site);
    }
    // Only the first line of a key carries the call; later ones just add what's new.
    if (rec.calls === 1 || rec.maxArgs !== maxArgs || rec.async !== async || rec.returns !== returns || rec.sites.length !== sites) {
      emit({ ...rec, calls: rec.calls === 1 ? 1 : 0 });
    }
  }

  /** A function in place of `fn` that goes through invoke() (for CommonJS exports). */
  function wrap(url, name, fn) {
    if (typeof fn !== 'function' || (phase !== 'calls' && !hollows(url, name))) return fn;
    return new Proxy(fn, {
      apply: (target, thisArg, args) => invoke(url, name, target, thisArg, args),
      construct: (target, args) => invoke(url, name, target, undefined, args, target),
    });
  }

  /** A CommonJS module's exports, with its functions wrapped (the object is changed in place). */
  function wrapExports(url, exp) {
    if (typeof exp === 'function') {
      seen(url, { default: exp });
      return wrap(url, 'default', exp);
    }
    if (!exp || typeof exp !== 'object') return exp;
    seen(url, exp);
    for (const key of Object.keys(exp)) {
      const d = Object.getOwnPropertyDescriptor(exp, key);
      if (!d) continue;
      if ('value' in d) {
        if (typeof d.value === 'function' && d.writable) exp[key] = wrap(url, key, d.value);
      } else if (d.get && d.configurable) {
        // Compiled ES modules (TypeScript, esbuild) export through getters.
        const get = d.get;
        let last;
        let wrapped;
        Object.defineProperty(exp, key, {
          ...d,
          get() {
            const v = get.call(this);
            if (v !== last) { last = v; wrapped = wrap(url, key, v); }
            return wrapped;
          },
        });
      }
    }
    return exp;
  }

  return { phase, seen, wrap, invoke, wrapExports };
}

/** Is this one of the user's own modules (not a dependency, not a test, not rubberstamp)? */
function own(url, rootUrl, selfUrl) {
  if (!url.startsWith(rootUrl) || url.startsWith(selfUrl) || url.includes('rubberstamp-orig')) return false;
  const path = url.slice(rootUrl.length).split('?')[0];
  return !/(^|\/)node_modules\//.test(path) && !TEST_FILE.test(`/${path}`) && /\.[cm]?[jt]sx?$/.test(path);
}

module.exports = { create, own, TEST_FILE };
