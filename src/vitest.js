// vitest (and vite) load your modules themselves, so the Node module hooks never see them.
// This plugin does the same wrapping inside vite:
//
//   // vitest.config.js
//   import rubberstamp from 'rubberstamp/vitest';
//   export default { plugins: [rubberstamp()] };
//
// It does nothing unless rubberstamp is running the tests.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sep } from 'node:path';
import { own, wrapperSource } from './hooks.mjs';

const ORIG = 'rubberstamp-orig';

export default function rubberstamp() {
  const env = process.env;
  const on = Boolean(env.RUBBERSTAMP_PHASE);
  const root = env.RUBBERSTAMP_ROOT || process.cwd();
  const rootUrl = pathToFileURL(root.endsWith(sep) ? root : root + sep).href;
  const self = new URL('.', import.meta.url).href;
  const names = on && env.RUBBERSTAMP_NAMES ? JSON.parse(readFileSync(env.RUBBERSTAMP_NAMES, 'utf8')) : {};

  return {
    name: 'rubberstamp',
    enforce: 'pre',
    // vitest 5 caches transformed modules on disk, keyed without our phase: a wrapper from one run
    // would be reused by the next.
    config: () => (on ? { test: { fsModuleCache: false } } : undefined),
    load(id) {
      if (!on || id.startsWith('\0')) return null;
      const [file, query = ''] = id.split('?');
      if (query.split('&').includes(ORIG)) return readFileSync(file, 'utf8');
      if (query) return null;
      const url = pathToFileURL(file).href;
      if (!own(url, rootUrl, self)) return null;
      const source = readFileSync(file, 'utf8');
      if (/\bmodule\.exports\b|\bexports\.[\w$]+\s*=/.test(source) && !/\bexport\b/.test(source)) return null;
      const hasDefault = /\bexport\s+default\b|\bas\s+default\b|\bas\s+["']default["']/.test(source);
      // The wrapper imports the original by file path, so vite resolves and transforms it as usual.
      return wrapperSource(url, names[url], hasDefault, file);
    },
  };
}
