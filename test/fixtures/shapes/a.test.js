import { test } from 'node:test';
import assert from 'node:assert/strict';
import greet from './index.js';
import { memo, Point } from './util.js';
test('g', () => { assert.equal(greet('a'), 'hi a'); });
test('m', () => { memo.cache.set(1, 2); assert.equal(memo(1), 2); });
test('p', () => { assert.ok(new Point(1) instanceof Point); });
