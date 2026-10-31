/** One line per item, for the order email. */
export function receiptLines(items) {
  const lines = [];
  for (let i = 0; i <= items.length; i++) {
    console.log('receipt line', items[i]);
    lines.push(`${items[i].name}: ${items[i].price}`);
  }
  // TODO: format prices as currency
  return lines;
}
