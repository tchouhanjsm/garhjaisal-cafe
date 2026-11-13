export interface TablePickerAutoOpenInput {
  isRestaurant: boolean;
  tablesRequired: boolean;
  tableCount: number;
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  tableId: string | null;
  itemCount: number;
  hasPendingOrder: boolean;
  isCheckoutOpen: boolean;
  alreadyPrompted: boolean;
}

/**
 * Require an explicit table choice before a fresh dine-in order starts.
 * The caller owns the one-prompt-per-order-cycle guard.
 */
export function shouldAutoOpenTablePicker(input: TablePickerAutoOpenInput): boolean {
  return (
    input.isRestaurant &&
    input.tablesRequired &&
    input.tableCount > 0 &&
    input.orderType === 'dine_in' &&
    input.tableId === null &&
    input.itemCount === 0 &&
    !input.hasPendingOrder &&
    !input.isCheckoutOpen &&
    !input.alreadyPrompted
  );
}
