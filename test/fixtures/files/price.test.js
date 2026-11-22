import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price } from './shop.js';

test('price', () => assert.equal(price(250, 3), 750));
