// Module customization hooks (run off the main thread). Every ES module of the project that isn't
// a test file or a dependency is replaced by a small wrapper module:
//
//   export * from '<url>?rubberstamp-orig';
//   import * as m from '<url>?rubberstamp-orig';
//   export const total = globalThis.__rubberstamp.wrap('<url>', 'total', m.total);
//
// An explicit export takes precedence over `export *`, so only the functions are swapped and every
// other export stays a live binding. The function names come from an earlier run (`names`).
const ORIG = 'rubberstamp-orig';
const TEST_FILE = /(\.|_|-)(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|[\\/]tests?[\\/]/;
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
  if (!url.startsWith(rootUrl) || url.startsWith(selfUrl) || url.includes(ORIG)) return false;
  const path = url.slice(rootUrl.length).split('?')[0];
  return !/(^|\/)node_modules\//.test(path) && !TEST_FILE.test(`/${path}`) && /\.[cm]?[jt]sx?$/.test(path);
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
  for (const name of fnNames) {
    if (name === 'default') {
      lines.push(`const __rs_default = rs ? rs.wrap(${u}, 'default', m.default) : m.default;`);
      lines.push('export { __rs_default as default };');
    } else if (IDENT.test(name)) {
      lines.push(`export const ${name} = rs ? rs.wrap(${u}, ${JSON.stringify(name)}, m.${name}) : m.${name};`);
    }
  }
  // `export *` never re-exports a default, so pass it through when it isn't wrapped.
  if (hasDefault && !fnNames.includes('default')) lines.push('export default m.default;');
  return lines.join('\n');
}

export async function load(url, context, next) {
  if (!own(url)) return next(url, context);
  const result = await next(url, context);
  if (result.format !== 'module') return result;
  const source = String(result.source ?? '');
  const hasDefault = /\bexport\s+default\b|\bas\s+default\b|\bas\s+["']default["']/.test(source);
  return { format: 'module', source: wrapperSource(url, names[url], hasDefault), shortCircuit: true };
}
