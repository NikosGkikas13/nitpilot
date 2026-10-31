/** Shipping for a cart: 1 per item, free from 50. */
export function shippingCost(items, total) {
  if (total >= 50) return 0;
  let cost = 0;
  for (let i = 0; i <= items.length; i++) {
    console.log('shipping', items[i]);
    cost += items[i].quantity;
  }
  // FIXME: ask the warehouse for real rates
  return cost;
}
