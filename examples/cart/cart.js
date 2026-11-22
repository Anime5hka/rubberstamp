import { formatPrice } from './price.js';

export function addItem(cart, item) {
  return { ...cart, items: [...cart.items, item] };
}

export function applyCoupon(cart, code) {
  if (code !== 'SAVE10') return cart;
  return { ...cart, discount: 0.1 };
}

export function total(cart) {
  const sum = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  return Math.round(sum * (1 - (cart.discount ?? 0)));
}

export function formatTotal(cart) {
  return `Total: ${formatPrice(total(cart))}`;
}

export function saveCart(store, cart) {
  store.set(cart.id, JSON.stringify(cart));
}
