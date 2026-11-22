'use strict';
// jest runs your modules in its own module system, so neither the Node module hooks nor the
// preload can see them. This transformer runs babel-jest as usual and, during a rubberstamp run,
// appends one line to each of your modules that wraps its exports:
//
//   // jest.config.js
//   transform: { '\\.[cm]?[jt]sx?$': 'rubberstamp/jest' }
//
// It does nothing unless rubberstamp is running the tests.
const { pathToFileURL } = require('node:url');
const { sep } = require('node:path');
const runtime = require('./runtime.cjs');

const RUNTIME = require.resolve('./runtime.cjs');
const self = pathToFileURL(__dirname + sep).href;
const on = () => Boolean(process.env.RUBBERSTAMP_PHASE);

let babel;
function inner() {
  if (!babel) {
    const babelJest = require(require.resolve('babel-jest', { paths: [process.cwd(), __dirname] }));
    babel = (babelJest.default ?? babelJest).createTransformer();
  }
  return babel;
}

function ownFile(filename, rootDir) {
  const root = process.env.RUBBERSTAMP_ROOT || rootDir || process.cwd();
  return runtime.own(pathToFileURL(filename).href, pathToFileURL(root.endsWith(sep) ? root : root + sep).href, self);
}

module.exports = {
  canInstrument: true,
  getCacheKey(source, filename, options) {
    // The appended line is the same in every phase, so "on or off" is all the cache needs to know.
    return `${inner().getCacheKey(source, filename, options)}:rubberstamp=${on() ? 1 : 0}`;
  },
  process(source, filename, options) {
    const result = inner().process(source, filename, options);
    if (!on() || !ownFile(filename, options.config && options.config.rootDir)) return result;
    const code = typeof result === 'string' ? result : result.code;
    // In jest's native ESM mode (--experimental-vm-modules) the module has no module.exports.
    if (options.supportsStaticESM && /^\s*export\b/m.test(code)) return result;
    const url = JSON.stringify(pathToFileURL(filename).href);
    const line = `\n;module.exports = require(${JSON.stringify(RUNTIME)}).create(process.env).wrapExports(${url}, module.exports);\n`;
    return typeof result === 'string' ? result + line : { ...result, code: code + line };
  },
};
