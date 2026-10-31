import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal } from './cart.js';

test('cartTotal adds up the prices', () => {
  assert.equal(cartTotal([{ price: 2 }, { price: 3 }]), 5);
});

test('cartTotal of an empty cart is 0', () => {
  assert.equal(cartTotal([]), 0);
});
