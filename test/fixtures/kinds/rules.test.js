import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdult, count, tags, slug, pick } from './rules.js';

test('adults', () => assert.ok(isAdult(30)));           // never tried with a minor
test('count', () => assert.equal(count([1, 2]), 2));
test('tags', () => assert.ok(Array.isArray(tags('a,b')))); // never looks inside
test('slug', () => assert.equal(slug('A'), 'a'));
test('pick', () => { assert.equal(pick(1), 1); assert.equal(pick(0), 'none'); });
