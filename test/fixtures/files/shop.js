export const price = (cents, qty) => cents * qty;
export const tax = (cents) => Math.round(cents * 0.2);
