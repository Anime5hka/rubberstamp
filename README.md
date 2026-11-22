<h1 align="center">rubberstamp 🔖</h1>

<p align="center">
  <b>Find the functions your tests call but never check.</b><br>
  rubberstamp hollows out each of your functions in turn and re-runs your tests.<br>
  If they still pass, no assertion depends on that function, and coverage was lying to you.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20.6-339933" alt="node >= 20.6">
  <img src="https://img.shields.io/badge/works%20with-node%3Atest%20%C2%B7%20vitest%20%C2%B7%20jest%20%C2%B7%20mocha-8957e5" alt="works with node:test, vitest, jest, mocha">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
</p>

<p align="center">
  <img src="assets/demo.svg" alt="rubberstamp on a cart module: 3 of 6 functions can be hollowed out and every test still passes. applyCoupon when it returns its first argument unchanged, saveCart when it does nothing, formatPrice when it returns undefined" width="900">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#setup">Setup</a> ·
  <a href="#what-it-finds">What it finds</a> ·
  <a href="#use-it-from-ai-coding-agents">AI agents</a> ·
  <a href="#how-it-compares">How it compares</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#options">Options</a> ·
  <a href="#in-ci">In CI</a> ·
  <a href="#faq">FAQ</a>
</p>

Every test in [that cart example](examples/cart/cart.test.js) passes, and line coverage is 100%. Yet `applyCoupon` could stop applying coupons, `saveCart` could stop saving and `formatPrice` could return `undefined`, and the suite would stay green:

```js
test('applies a coupon', () => {
  const discounted = applyCoupon(cart, 'SAVE10');
  assert.ok(discounted);                       // true for the cart without a discount, too
  assert.equal(discounted.items.length, 1);
});

test('saves the cart', () => {
  assert.doesNotThrow(() => saveCart(store, cart));   // never looks at the store
});
```

Tests like these are easy to write and easy to miss in review, and AI coding assistants write a lot of them. Coverage counts them as tested, because the lines ran. rubberstamp asks a stricter question: **if this function did nothing, would any test notice?**

## Quick start

```sh
npx github:Anime5hka/rubberstamp -- node --test
npx github:Anime5hka/rubberstamp -- npx mocha
npx github:Anime5hka/rubberstamp -- npm test
```

Everything after `--` is your normal test command. node:test and mocha work as they are. vitest and jest need one line of config, see [Setup](#setup).

rubberstamp runs your suite once to see which of your exported functions the tests call. Then it runs the suite again once per function, with that function **hollowed out**: it returns `undefined` without running, or hands back its first argument unchanged, which is what "did nothing" looks like for a function like `applyCoupon(cart)`. A function whose hollow version passes every test is *rubber-stamped*.

## Setup

| Runner | What to add |
|---|---|
| node:test | nothing |
| mocha | nothing |
| vitest | `plugins: [rubberstamp()]` with `import rubberstamp from 'rubberstamp/vitest'` in `vitest.config.*` |
| jest | `transform: { '\\.[cm]?[jt]sx?$': 'rubberstamp/jest' }` in the jest config (runs babel-jest as usual) |

vitest and jest load your modules with their own module systems, where Node's loader hooks can't reach. The plugin and the transformer do nothing unless rubberstamp is running the tests, so they're safe to leave in. For them, install it: `npm i -D github:Anime5hka/rubberstamp`.

ES modules, CommonJS and TypeScript (with Node's built-in type stripping, or through vitest) are supported.

## What it finds

From the [cart example](examples/cart):

| Function | Test | Survives when it… | Why the test can't tell |
|---|---|---|---|
| `applyCoupon(cart, code)` | `assert.ok(discounted)` | returns its first argument unchanged | any cart is truthy |
| `saveCart(store, cart)` | `assert.doesNotThrow(...)` | does nothing | nobody reads the store |
| `formatPrice(cents)` | `formatTotal(cart).startsWith('Total:')` | returns `undefined` | `"Total: undefined"` starts with `Total:` |
| `total`, `addItem`, `formatTotal` | real assertions | — | caught ✓ |

**In the wild.** We ran rubberstamp on our own [raceloom](https://github.com/Anime5hka/raceloom) (39 tests). It found `formatError()`: every test still passed when it returned the error object itself, because a template string turns an `Error` into `"AssertionError: ..."` anyway. The one-line summary it exists for was never checked. [Fixed with two tests](https://github.com/Anime5hka/raceloom/blob/main/test/format.test.js). It also found `Sim#clearInterval()`: a test called it, but nothing checked that the interval stopped. On [shakeout](https://github.com/Anime5hka/shakeout) it found that nothing pinned the hash behind its replayable seeds: `hash32()` could return its input unchanged and every test still passed. [Fixed](https://github.com/Anime5hka/shakeout/blob/main/test/unit.test.js). On [sqlloom](https://github.com/Anime5hka/sqlloom) (a 6-minute suite against a real Postgres) it found `dbError()`, which digs the Postgres error out of an ORM's wrapper: it could return `undefined` and all 29 tests still passed. [Fixed](https://github.com/Anime5hka/sqlloom/blob/main/test/errors.test.js).

## Use it from AI coding agents

Agents write a lot of tests that can't fail. [`skills/rubberstamp/SKILL.md`](skills/rubberstamp/SKILL.md) is an agent skill that teaches Claude Code (and other agents that read `SKILL.md`) to check their tests with rubberstamp and to strengthen the weak ones instead of adding trivial new ones. Install it for your user:

```sh
mkdir -p ~/.claude/skills/rubberstamp && curl -fsSL https://raw.githubusercontent.com/Anime5hka/rubberstamp/main/skills/rubberstamp/SKILL.md -o ~/.claude/skills/rubberstamp/SKILL.md
```

Then ask: *"do the tests for the cart module actually check anything?"*

## How it compares

| | Finds weak assertions | Finds mocked-away subjects | Setup | Runs |
|---|:-:|:-:|---|---|
| Line / branch coverage | ❌ a line that ran counts | ❌ | built in | 1 |
| Assertion linters (`expect-expect`, [hollowtest](https://www.npmjs.com/package/hollowtest)) | only the obvious: no assertion, `expect(x)` without a matcher | ❌ | a lint rule | 0 |
| [Stryker](https://stryker-mutator.io/) mutation testing | ✅ thorough: hundreds of small mutants per file | ✅ | config file, per-runner plugin | one per mutant, often hours |
| [PIT Descartes](https://github.com/STAMP-project/pitest-descartes) (the same idea as rubberstamp) | ✅ | ✅ | Maven/Gradle | Java only |
| **rubberstamp** | ✅ per function | ✅ | none for node:test and mocha | 2 + one or two per called function |

rubberstamp is *extreme mutation testing*: instead of flipping a `<` to `<=` everywhere, it removes a whole function. That makes far fewer runs, and every finding is easy to read: "nothing checks what this function does". Stryker still finds more (an off-by-one inside a function that *is* checked). Use rubberstamp first, and Stryker on the code that matters most.

## How it works

1. **Wrapping without a parser.** `NODE_OPTIONS=--import` loads a preload into every Node process of your test command. For each ES module of yours (not tests, not `node_modules`), a module hook returns a small wrapper instead: `export * from './cart.js?orig'` plus an explicit `export const applyCoupon = wrap(...)` for each function. An explicit export beats `export *`, so the functions are swapped and every other export stays a live binding. CommonJS modules get their `module.exports` wrapped right after they run. vitest and jest do the same through the plugin and the transformer.
2. **Run 1: names.** A normal run that records which exports are plain functions (not classes). If your suite fails here, rubberstamp stops: it needs a green suite to start from.
3. **Run 2: calls.** Every function is wrapped in a `Proxy` that records whether the tests call it, how many arguments it gets, whether it returns anything (or a promise), and the first line in a test file on the call stack.
4. **One run per hollow function.** For each called function: a run where it returns `undefined` (a resolved promise of `undefined` if it's async), and, if it normally returns something and takes arguments, a run where it returns its first argument. Runs go in parallel. A run that fails, or takes 5× longer than normal, means the tests caught it.

Calls from inside the same module go straight to the function, not through the export, so they aren't hollowed. That's deliberate: it keeps the question about the function's *contract*, as the rest of your code and your tests see it.

## Options

```
rubberstamp [options] -- <test command...>
```

| | |
|---|---|
| `--concurrency <n>` | Test runs at the same time (default: half your CPUs). Use 1 if your tests share a port or a database |
| `--only <text>` | Only hollow functions in files whose path contains `<text>`, e.g. `--only src/billing` |
| `--changed <ref>` | Only hollow functions in files changed since a git ref, e.g. `--changed origin/main` in a PR check |
| `--timeout <ms>` | A run that takes longer counts as caught (default: 5× the normal run, at least 10 s) |
| `--json` | Machine-readable result |

Exit code: `0` if every called function is caught, `1` if any is rubber-stamped or the suite fails, `2` for usage errors.

## In CI

On pull requests, check only the functions the PR touches:

```yaml
# .github/workflows/rubberstamp.yml
on: pull_request
jobs:
  rubberstamp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # --changed needs the base branch
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx github:Anime5hka/rubberstamp --changed origin/${{ github.base_ref }} -- npm test
```

## FAQ

**Isn't a function called only through other functions "tested"?** It is, if hollowing it breaks one of those tests. rubberstamp counts any failing test, not just tests that call the function directly. `formatPrice` above is called only through `formatTotal`, and it's rubber-stamped because the `formatTotal` test doesn't look at the price.

**How long does it take?** About (2 + 1.5 × called functions) suite runs, divided by `--concurrency`. For a suite that takes 5 s and 40 functions, that's around 3 minutes on 4 cores. Use `--only` on the module you're working on.

**My function is supposed to return its argument / nothing.** Then it can't be told apart from its hollow version, and rubberstamp reports what the tests *can't* see. Ignore it, or assert on what it does.

**Does it change my code?** No. Everything happens in memory, through loader hooks, while your tests run.

## Caveats

- **Exported functions and the methods of exported objects and classes.** Private helpers are covered through the exports that call them. Getters, setters and frozen objects are left alone.
- **Methods are replaced in place.** `api.get` and `Cart.prototype.total` become wrapper functions while rubberstamp runs, so code that compares them by identity (`hooks.afterEach === myHook`) sees a different function. Plain exported functions don't have this problem.
- **A flaky suite gives flaky answers.** A random failure in a hollow run counts as "caught". If your suite is flaky, fix that first ([shakeout](https://github.com/Anime5hka/shakeout) can help).
- **Side effects at import time** run once per test run, like they do now.
- **jest**: CommonJS mode through babel-jest. Native ESM mode (`--experimental-vm-modules`) and ts-jest aren't supported yet.

## Roadmap

- [x] Class methods (`Cart#total`, static `Cart.create`) and object-literal methods (`api.get`)
- [ ] More ways to hollow: `return 0` / `''` / `[]` / `false` by the type the function normally returns
- [ ] Re-run only the test files that call the function (much faster on big suites)
- [x] `--changed <ref>`: only functions in files changed since a git ref, for PR checks
- [ ] A GitHub Action that comments the rubber-stamped functions on a PR
- [x] An agent skill: "after writing tests, check them with rubberstamp"

## See also

[shakeout](https://github.com/Anime5hka/shakeout) finds flaky tests with timing jitter. [raceloom](https://github.com/Anime5hka/raceloom) and [sqlloom](https://github.com/Anime5hka/sqlloom) find race conditions in async code and SQL transactions.

## License

[MIT](LICENSE)
