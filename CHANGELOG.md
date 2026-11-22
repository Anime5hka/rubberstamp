# Changelog

## 0.1.0 (unreleased)

First release.

- `rubberstamp -- <test command>`: finds the exported functions your tests call but never check, by re-running the suite with each one hollowed out.
- Two ways to hollow: return `undefined` (or do nothing; a resolved `undefined` for async functions), and return the first argument unchanged.
- Reports where each function is defined and the test lines that call it.
- node:test and mocha with no setup; a vitest plugin (`rubberstamp/vitest`) and a jest transformer (`rubberstamp/jest`).
- ES modules, CommonJS (including compiled getters) and TypeScript (Node type stripping, vitest).
- Parallel runs (`--concurrency`), `--only`, `--timeout`, `--json`.
