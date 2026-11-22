// Preload (`node --import`, also through NODE_OPTIONS): installs the runtime the wrapper modules
// call into, the ES module hooks, and the CommonJS wrapping. Does nothing outside a rubberstamp run.
import Module, { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sep } from 'node:path';
import { own } from './hooks.mjs';

const env = process.env;

if (env.RUBBERSTAMP_PHASE && !globalThis.__rubberstamp) {
  const root = env.RUBBERSTAMP_ROOT || process.cwd();
  const rootUrl = pathToFileURL(root.endsWith(sep) ? root : root + sep).href;
  const self = new URL('.', import.meta.url).href;
  const names = env.RUBBERSTAMP_NAMES ? JSON.parse(readFileSync(env.RUBBERSTAMP_NAMES, 'utf8')) : {};
  const rs = createRequire(import.meta.url)('./runtime.cjs').create(env);
  // A node:test file whose tests never call the hollowed function can't notice it: pass at once.
  if (rs.irrelevant()) process.exit(0);
  globalThis.__rubberstamp = rs;

  // CommonJS modules don't go through the module hooks. Their exports object is mutable, though,
  // so it is wrapped right after the module has run, before anyone can require() it.
  const realLoad = Module.prototype.load;
  Module.prototype.load = function load(filename) {
    realLoad.call(this, filename);
    const url = pathToFileURL(filename).href;
    if (own(url, rootUrl, self)) this.exports = rs.wrapExports(url, this.exports);
  };

  register('./hooks.mjs', { parentURL: import.meta.url, data: { root: rootUrl, self, names } });
}
