import assert from 'node:assert/strict';
import { findOrderForBill } from '../frontend/src/lib/order-print-context';

function main(): void {
  const listedOrder = { id: 1, bill: { id: 101 } } as any;
  const selectedSnapshot = { id: 2, bill: { id: 202 } } as any;

  assert.equal(findOrderForBill([listedOrder], selectedSnapshot, 101), listedOrder);
  assert.equal(findOrderForBill([], selectedSnapshot, 202), selectedSnapshot);
  assert.equal(findOrderForBill([listedOrder], selectedSnapshot, 202), selectedSnapshot);
  assert.equal(findOrderForBill([], selectedSnapshot, 303), undefined);
  assert.equal(findOrderForBill([], { id: 3, bill: null } as any, 303), undefined);

  console.log('Order bill-print context tests passed.');
}

main();
