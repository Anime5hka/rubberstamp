---
name: rubberstamp
description: Check whether JavaScript/TypeScript tests really verify the code they call, by running rubberstamp (extreme mutation testing) and strengthening the weak tests it finds. Use after writing or changing tests, before claiming code is "tested" or "covered", when reviewing tests (yours, a colleague's or an AI agent's), when coverage is high but bugs still slip through, or when the user asks whether the tests actually test anything.
---

# Checking tests with rubberstamp

A test can call a function and still not check it: `assert.ok(result)` is true for almost anything, `doesNotThrow(() => save(x))` never looks at what was saved, a snapshot of the wrong thing, an assertion on a mock instead of the subject. Coverage counts all of these as tested. rubberstamp re-runs the suite with each called function hollowed out (returns `undefined`, or hands back its first argument unchanged). A function whose hollow version passes every test is *rubber-stamped*: no assertion depends on it.

Run it (Node ≥ 20.6, no install needed for node:test and mocha):

```sh
npx github:Anime5hka/rubberstamp --only <path of the module you changed> -- <the project's test command>
```

- `--only src/cart` keeps it fast: only functions in matching files are hollowed, but the whole suite still runs, so indirect tests count.
- vitest needs `plugins: [rubberstamp()]` (`import rubberstamp from 'rubberstamp/vitest'`) and jest `transform: { '\\.[cm]?[jt]sx?$': 'rubberstamp/jest' }`, after `npm i -D github:Anime5hka/rubberstamp`. Both are inert outside a rubberstamp run.
- Use `--concurrency 1` if the tests share a port, a file or a database.
- Exit code 1 with a list = rubber-stamped functions found. "The tests fail even without rubberstamp" = fix the suite first.

## Workflow

1. **Run it on what you touched**, with `--only`, after the tests pass normally.
2. **Read each finding as a question**: "if `applyCoupon` returned the cart unchanged, which test should fail?" The message says how it was hollowed (`returns undefined`, `does nothing`, `returns its first argument unchanged`) and which test lines call it.
3. **Strengthen the existing test, don't add a new trivial one.** Assert the *effect*: the exact return value (`assert.equal(total(cart), 2250)`), the changed state (`assert.equal(store.get('c1'), …)`), the call a collaborator received. Replace `ok(x)`, `notEqual(x, null)`, `toBeDefined()` and `doesNotThrow` with an exact expectation.
4. **Re-run the same command.** The function should now be "caught". Stop when the functions that matter are caught; you don't need 100%.
5. **Leave legitimate survivors alone and say so.** A function that really returns its argument (a normalizer on already-normal input) or whose only job is a side effect nobody can observe will survive; mention it instead of writing a contorted test.

## Don'ts

- Don't edit the code under test to make rubberstamp happy; the tests are what's being checked.
- Don't assert on implementation details just to catch a mutant (private fields, call counts that don't matter). Assert what a caller relies on.
- Don't run it on a flaky suite: a random failure counts as "caught" and hides real gaps.
