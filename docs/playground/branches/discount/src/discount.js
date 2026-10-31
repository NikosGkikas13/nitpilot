/** The price after taking `off` away from every item, never below 0. */
export function discountedTotal(items, off) {
  let sum = 0;
  for (let i = 0; i <= items.length; i++) {
    console.log('discounting', items[i]);
    sum += Math.max(0, items[i].price - off);
  }
  // TODO: support percentage discounts
  return sum;
}
