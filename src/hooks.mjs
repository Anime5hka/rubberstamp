// Module customization hooks (run off the main thread). Every ES module of the project that isn't
// a test file or a dependency is replaced by a small wrapper module:
//
//   export * from '<url>?rubberstamp-orig';
//   import * as m from '<url>?rubberstamp-orig';
//   export const total = globalThis.__rubberstamp.wrap('<url>', 'total', m.total);
//
// An explicit export takes precedence over `export *`, so only the functions are swapped and every
// other export stays a live binding. The function names come from an earlier run (`names`).
import runtime from './runtime.cjs';

const ORIG = 'rubberstamp-orig';
const IDENT = /^[A-Za-z_$][\w$]*$/;

let root = '';
let self = '';
let names = {};

export function initialize(data) {
  root = data.root;
  self = data.self;
  names = data.names || {};
}

/** Is this one of the user's own modules (not a dependency, not a test, not us)? */
export function own(url, rootUrl = root, selfUrl = self) {
  return runtime.own(url, rootUrl, selfUrl);
}

/** Does this module source have a default export (including `export { default } from '...'`)? */
export function hasDefaultExport(source) {
  return /\bexport\s+default\b|\bas\s+["']?default\b|\bexport\s*\{[^}]*\bdefault\b/.test(source);
}

export function wrapperSource(url, fnNames = [], hasDefault = false, origSpecifier = url) {
  const orig = JSON.stringify(origSpecifier + (origSpecifier.includes('?') ? '&' : '?') + ORIG);
  const u = JSON.stringify(url);
  const lines = [
    `export * from ${orig};`,
    `import * as m from ${orig};`,
    `const rs = globalThis.__rubberstamp;`,
    `rs?.seen(${u}, m);`,
  ];
  // Function declarations are hoisted, so in an import cycle the wrapped functions can be called
  // before this module has run, just like the originals. `m.name` is read at call time for the
  // same reason.
  fnNames.forEach((name, i) => {
    if (name !== 'default' && !IDENT.test(name)) return;
    const fn = `__rs_${i}`;
    const n = JSON.stringify(name);
    lines.push(`export { ${fn} as ${name === 'default' ? 'default' : name} };`);
    lines.push(`function ${fn}(...args) { return globalThis.__rubberstamp.invoke(${u}, ${n}, m[${n}], this, args, new.target); }`);
    // Same name, prototype and own properties as the original, so `instanceof` and `fn.cache`
    // keep working. (In an import cycle the original may not exist yet; then there's nothing to copy.)
    lines.push(`try { for (const k of Reflect.ownKeys(m[${n}])) if (k !== 'length' && k !== 'arguments' && k !== 'caller') Object.defineProperty(${fn}, k, Object.getOwnPropertyDescriptor(m[${n}], k)); } catch {}`);
  });
  // Methods of exported objects and classes are wrapped in place, once the original has run.
  lines.push(`rs?.members(${u}, m);`);
  // `export *` never re-exports a default, so pass it through when it isn't wrapped.
  if (hasDefault && !fnNames.includes('default')) lines.push('export default m.default;');
  return lines.join('\n');
}

export async function load(url, context, next) {
  if (!own(url)) return next(url, context);
  const result = await next(url, context);
  // .ts files under Node's type stripping come back as 'module-typescript'; the wrapper itself is JS.
  if (result.format !== 'module' && result.format !== 'module-typescript') return result;
  const source = String(result.source ?? '');
  const hasDefault = hasDefaultExport(source);
  return { format: 'module', source: wrapperSource(url, names[url], hasDefault), shortCircuit: true };
}
