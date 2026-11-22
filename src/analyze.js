// Pure helpers: merge what the runs recorded, and find where a function is defined.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

/** names-phase records (one per module per process) -> { moduleUrl: [function names] } */
export function mergeNames(records) {
  const names = {};
  for (const r of records) {
    if (r.type !== 'module') continue;
    const list = (names[r.url] ??= []);
    for (const fn of r.fns) if (!list.includes(fn)) list.push(fn);
  }
  return names;
}

/** calls-phase records -> one entry per called function, in a stable order */
export function mergeCalls(records) {
  const byKey = new Map();
  for (const r of records) {
    if (r.type !== 'call') continue;
    const key = `${r.url}#${r.name}`;
    const e = byKey.get(key) ?? { url: r.url, name: r.name, calls: 0, async: false, returns: false, maxArgs: 0, sites: [] };
    e.calls += r.calls;
    e.async ||= r.async;
    e.returns ||= Boolean(r.returns);
    e.maxArgs = Math.max(e.maxArgs, r.maxArgs ?? 0);
    for (const s of r.sites) if (!e.sites.includes(s) && e.sites.length < 5) e.sites.push(s);
    byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => a.url.localeCompare(b.url) || a.name.localeCompare(b.name));
}

const escape = (s) => s.replace(/[$]/g, '\\$');

/** 1-based line where `name` is defined in the module's source, or null. */
export function definitionLine(source, name) {
  if (/[.#]/.test(name)) {
    // api.get / Cart#total / Cart.create: the method, as `get(`, `get: (`, `get = (` or `get: function`
    const m = escape(name.split(/[.#]/).pop());
    const re = new RegExp(`^\\s*(?:static\\s+)?(?:async\\s+)?\\*?\\s*${m}\\s*(?:\\(|[:=]\\s*(?:async\\s*)?(?:function\\b|\\(|[\\w$]+\\s*=>))`);
    const i = source.split('\n').findIndex((l) => re.test(l));
    return i >= 0 ? i + 1 : null;
  }
  const n = escape(name);
  const patterns = name === 'default'
    ? [/export\s+default\b/]
    : [
      new RegExp(`\\bfunction\\s*\\*?\\s*${n}\\s*\\(`),
      new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=`),
      new RegExp(`\\bexport\\s*\\{[^}]*\\b${n}\\b`),
      new RegExp(`\\bexports\\.${n}\\s*=`),
    ];
  const lines = source.split('\n');
  for (const re of patterns) {
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return i + 1;
  }
  return null;
}

/** "src/price.js:12" for a module URL and an export name. */
export function where(url, name, root) {
  let file;
  try { file = fileURLToPath(url.split('?')[0]); } catch { return url; }
  const rel = relative(root, file);
  let line = null;
  try { line = definitionLine(readFileSync(file, 'utf8'), name); } catch {}
  return line ? `${rel}:${line}` : rel;
}

/**
 * The ways to hollow out a called function: it always can return undefined (or do nothing), and a
 * function that returns something and takes an argument can also hand its first argument back
 * unchanged, which is how "applyCoupon(cart) did nothing" looks.
 */
export function mutantsFor(f) {
  const list = [{ mode: 'undefined', says: f.returns ? `returns undefined` : 'does nothing' }];
  if (f.returns && f.maxArgs > 0) list.push({ mode: 'identity', says: 'returns its first argument unchanged' });
  return list;
}
