const { formatPrice } = require('./price.js');

exports.addItem = function addItem(cart, item) {
  return { ...cart, items: [...cart.items, item] };
}

exports.applyCoupon = function applyCoupon(cart, code) {
  if (code !== 'SAVE10') return cart;
  return { ...cart, discount: 0.1 };
}

exports.total = function total(cart) {
  const sum = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  return Math.round(sum * (1 - (cart.discount ?? 0)));
}

exports.formatTotal = function formatTotal(cart) {
  return `Total: ${formatPrice(exports.total(cart))}`;
}

exports.saveCart = function saveCart(store, cart) {
  store.set(cart.id, JSON.stringify(cart));
}
