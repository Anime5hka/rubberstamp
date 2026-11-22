# rubberstamp — one-pager (working name)

**Problem.** Tests that can't fail. A test calls `total(items)` and asserts `ok(true)`, or checks
`result !== undefined`, or mocks the very function it claims to test. Coverage says 100%. AI coding
agents write a lot of these (Thoughtworks Radar, Nov 2026: "perpetually green" tests). Linters
(hollowtest ×2) catch the obvious syntax (no assertion, `expect(x)` without a matcher), not weak
assertions or mocked subjects. Stryker catches them, but it's slow and needs config. PIT/Descartes
"extreme mutation" (pseudo-tested methods) exists only for Java.

**Product.** `npx rubberstamp -- npm test`:
1. Discovery run: a preload (`NODE_OPTIONS=--import`, like shakeout) wraps every module of yours
   (not node_modules, not test files) and records its exports, and which exported functions the
   tests call (directly or through your other modules).
2. For each exported function that is called: run the suite with it **hollowed** (returns
   `undefined`; later also: returns its first argument, throws, resolves `undefined` for async).
3. Report:

       ✗ total()  price.js:2   hollowed, and every test still passed
           called by: weak total (price.test.js:6)
       ✓ formatPrice()  failed 1 test when hollowed

   "Hollowed and still green" = no assertion depends on what the function returns.

**Mechanics (probe in /tmp/rs-probe, works on node:test).** ESM load hook returns a wrapper module:
`export * from '<url>?rubberstamp-orig'; import * as m from ...; export const name = wrap(m.name)`.
An explicit export beats `export *`, so no parser is needed: the names come from the discovery run
(`Object.keys(m)`); `default` has to be re-exported explicitly. CJS: wrap `module.exports` after
load (mutable). Calls inside the same module bypass the wrapper, so we only make claims about calls
that go through an export, which is what the discovery run counts.

**Runners.** node:test and mocha via `--import` first. vitest: vite transforms modules itself, so it
needs a small vite plugin (`?rubberstamp-orig` + the same wrapper source). jest: a transformer
wrapper. One suite run per mutant, run in parallel (cpus).

**Name.** npm `rubberstamp` is free. GitHub has vinaygaba/RubberStamp (424★, Android, unrelated).
Fallback: `pseudotested`.
