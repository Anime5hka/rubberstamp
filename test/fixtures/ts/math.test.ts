import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total, label } from './math.ts';
test('t', () => { assert.equal(total([1, 2]), 3); label(1); });
