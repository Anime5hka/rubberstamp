import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prices, Cart } from './shop.js';

test('net price', () => { assert.equal(prices.net(1200), 1000); });
test('label', () => { assert.ok(prices.label(100)); });
test('cart', () => {
  const cart = Cart.empty().add({ price: 5 });
  assert.notEqual(cart.total(), null);
});
