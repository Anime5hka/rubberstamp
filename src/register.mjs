// Preload (`node --import`, also through NODE_OPTIONS): installs the module hooks and the runtime the
// wrapper modules call into. What it does depends on RUBBERSTAMP_PHASE:
//   names   record which exports of each module are plain functions
//   calls   record which of those functions the tests call, and from where
//   mutant  hollow out one function (RUBBERSTAMP_TARGET) and let everything else run as usual
import { register } from 'node:module';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { relative, sep } from 'node:path';

const env = process.env;
const phase = env.RUBBERSTAMP_PHASE;

if (phase && !globalThis.__rubberstamp) {
  const root = env.RUBBERSTAMP_ROOT || process.cwd();
  const rootUrl = pathToFileURL(root.endsWith(sep) ? root : root + sep).href;
  const self = new URL('.', import.meta.url).href;
  const names = env.RUBBERSTAMP_NAMES ? JSON.parse(readFileSync(env.RUBBERSTAMP_NAMES, 'utf8')) : {};
  const [targetUrl, targetName, targetAsync] = (env.RUBBERSTAMP_TARGET || '').split('#');

  const TEST_FILE = /(\.|_|-)(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|[\\/]tests?[\\/]/;
  const records = new Map(); // key -> record, written once at exit
  const put = (key, init) => {
    if (!records.has(key)) records.set(key, init());
    return records.get(key);
  };
  const isClass = (fn) => /^class[\s{]/.test(Function.prototype.toString.call(fn));

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

  globalThis.__rubberstamp = {
    seen(url, m) {
      if (phase !== 'names') return;
      const rec = put(url, () => ({ type: 'module', url, fns: [] }));
      for (const [k, v] of Object.entries(m)) {
        if (typeof v === 'function' && !isClass(v) && !rec.fns.includes(k)) rec.fns.push(k);
      }
    },
    wrap(url, name, fn) {
      if (typeof fn !== 'function') return fn;
      const hollow = phase === 'mutant' && url === targetUrl && name === targetName;
      if (phase !== 'calls' && !hollow) return fn;
      return new Proxy(fn, {
        apply(target, thisArg, args) {
          if (hollow) return targetAsync === 'async' ? Promise.resolve(undefined) : undefined;
          const result = Reflect.apply(target, thisArg, args);
          const rec = put(`${url}#${name}`, () => ({ type: 'call', url, name, calls: 0, async: false, sites: [] }));
          rec.calls++;
          if (result && typeof result.then === 'function') rec.async = true;
          if (rec.calls <= 50) {
            const site = testSite();
            if (site && !rec.sites.includes(site) && rec.sites.length < 5) rec.sites.push(site);
          }
          return result;
        },
      });
    },
  };

  if (env.RUBBERSTAMP_OUT) {
    process.on('exit', () => {
      if (!records.size) return;
      try {
        appendFileSync(env.RUBBERSTAMP_OUT, [...records.values()].map((r) => `${JSON.stringify(r)}\n`).join(''));
      } catch {}
    });
  }

  register('./hooks.mjs', { parentURL: import.meta.url, data: { root: rootUrl, self, names } });
}
