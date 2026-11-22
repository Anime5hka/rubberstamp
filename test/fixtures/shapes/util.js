export function memo(x) { return memo.cache.get(x) ?? x; }
memo.cache = new Map();
export function Point(x) { this.x = x; }
