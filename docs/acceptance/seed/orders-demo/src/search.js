// Looks orders up by customer name.

/** Every order placed by this customer. `db.query` takes the SQL text to run. */
export function ordersOfCustomer(db, customer) {
  return db.query("SELECT * FROM orders WHERE customer = '" + customer + "'");
}
