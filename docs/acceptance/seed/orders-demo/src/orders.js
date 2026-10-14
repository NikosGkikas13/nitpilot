// Order helpers.

/** One page of items. Pages start at 1, so page 1 is the first `size` items. */
export function paginate(items, page, size) {
  const start = page * size;
  return items.slice(start, start + size);
}

/** The average of the order totals, in cents. */
export function averageTotal(totals) {
  const sum = totals.reduce((a, b) => a + b, 0);
  return sum / totals.length;
}

/** A one-line description of the order with this id. */
export function describeOrder(orders, id) {
  const order = orders.find((o) => o.id === id);
  return `Order #${order.id} for ${order.customer}: ${order.total} cents`;
}
