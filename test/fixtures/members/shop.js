export const prices = {
  net(cents) { return Math.round(cents / 1.2); },
  label: (cents) => '$' + (cents / 100).toFixed(2),
};

export class Cart {
  constructor() { this.items = []; }
  add(item) { this.items.push(item); return this; }
  total() { return this.items.reduce((s, i) => s + i.price, 0); }
  static empty() { return new Cart(); }
}
