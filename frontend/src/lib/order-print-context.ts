import type { Order } from '@/lib/types';

/**
 * Resolve the order that owns a bill, including the currently selected detail
 * snapshot when pagination has moved that order out of the visible list.
 */
export function findOrderForBill(
  orders: readonly Order[],
  selectedOrder: Order | null | undefined,
  billId: number,
): Order | undefined {
  const listedOrder = orders.find((order) => order.bill?.id === billId);
  if (listedOrder) return listedOrder;

  return selectedOrder?.bill?.id === billId ? selectedOrder : undefined;
}
