// Every test here passes, and the line coverage of cart.js and price.js is 100%.
// rubberstamp shows which of these functions no test really checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addItem, applyCoupon, total, formatTotal, saveCart } = require('./cart.js');

const cart = { id: 'c1', items: [{ name: 'Mug', price: 1250, qty: 2 }] };

test('adds an item', () => {
  const next = addItem(cart, { name: 'Tea', price: 500, qty: 1 });
  assert.equal(next.items.length, 2);
});

test('computes the total', () => {
  assert.equal(total(cart), 2500);
});

test('applies a coupon', () => {
  const discounted = applyCoupon(cart, 'SAVE10');
  assert.ok(discounted);
  assert.equal(discounted.items.length, 1);
});

test('formats the total', () => {
  assert.ok(formatTotal(cart).startsWith('Total:'));
});

test('saves the cart', () => {
  const store = new Map();
  assert.doesNotThrow(() => saveCart(store, cart));
});
