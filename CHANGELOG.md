# Changelog

## 0.1.0 (unreleased)

First release.

- `rubberstamp -- <test command>`: finds the exported functions your tests call but never check, by re-running the suite with each one hollowed out.
- Exported functions, plus methods of exported objects (`api.get`) and classes (`Cart#total`, `Cart.create`).
- Ways to hollow: return `undefined` (or do nothing; a resolved `undefined` for async functions), return the first argument unchanged, and, for sync functions that always return one type, `0`, `''`, `[]`, or a constant `true` / `false`.
- Reports where each function is defined and the test lines that call it.
- node:test and mocha with no setup; a vitest plugin (`rubberstamp/vitest`) and a jest transformer (`rubberstamp/jest`).
- ES modules, CommonJS (including compiled getters) and TypeScript (Node type stripping, vitest).
- Parallel runs (`--concurrency`), `--only`, `--changed <git ref>`, `--timeout`, `--json`.
