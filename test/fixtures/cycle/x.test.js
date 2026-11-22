import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useB } from './a.js';
test('x', () => { assert.equal(useB(), 2); });
