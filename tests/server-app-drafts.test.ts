import assert from 'node:assert/strict';
import {
  formatServerAppManualTicketTemplate,
  formatServerAppTicketNote,
  getServerAppTimestamp,
  loadServerAppCatalog,
  loadServerAppDraft,
  loadServerAppLocalUser,
  saveServerAppCatalog,
  saveServerAppDraft,
  saveServerAppLocalUser,
} from '../frontend/src/lib/server-app-local';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
assert.match(
  getServerAppTimestamp(),
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  'the Server App timestamp helper returns a UTC ISO timestamp',
);
const user = {
  id: 'staff-1',
  name: 'Waiter One',
  email: 'waiter@example.test',
  role: 'server',
};
assert.equal(saveServerAppLocalUser(storage, user), true);
assert.deepEqual(loadServerAppLocalUser(storage, user.id), user);

const catalog = {
  categories: [{ id: 'drinks' }],
  products: [{ id: 'tea', name: 'Masala Chai' }],
  tables: [{ id: 'table-1', name: '1' }],
};
assert.equal(saveServerAppCatalog(storage, user.id, catalog), true);
assert.deepEqual(loadServerAppCatalog(storage, user.id)?.products, catalog.products);

const draft = {
  tableId: 'table-1',
  tableName: '1',
  draftLines: [
    {
      id: 'line-1',
      product: { name: 'Masala Chai' },
      quantity: 2,
      addons: [{ name: 'Extra Ginger' }],
      special_instructions: 'Less sugar',
    },
  ],
  customerName: 'Guest',
  customerPhone: '9999999999',
  orderNotes: 'Room 4 — terrace',
  savedAt: '2026-11-11T12:00:00.000Z',
  attempt: {
    signature: 'same',
    nonce: 'retry-token',
    snapshot: {
      tableId: 'table-1',
      tableName: '1',
      orderId: null,
      orderCustomer: null,
      existingItemIds: [],
      draftLines: [],
      customerName: 'Guest',
      customerPhone: '9999999999',
      orderNotes: 'Room 4',
    },
  },
};
assert.equal(saveServerAppDraft(storage, user.id, draft), true);
assert.deepEqual(loadServerAppDraft(storage, user.id), draft);

const manualTemplate = formatServerAppManualTicketTemplate('2026-11-12T10:00:00.000Z');
assert.match(manualTemplate, /STATUS: MANUAL NOTE — NOT SENT TO KITCHEN/);
assert.ok(
  manualTemplate.includes('\nTABLE / ROOM:'),
  'the blank manual ticket is copied as real multiline text',
);
assert.match(manualTemplate, /TABLE \/ ROOM/);
assert.match(manualTemplate, /MODIFIERS/);
assert.match(
  manualTemplate,
  /not a FloCafe order, does not reserve a table, and has not printed/i,
);
assert.match(
  manualTemplate,
  /Verify the table\/current order on the Windows hub, then enter and send once/i,
);

const note = formatServerAppTicketNote({
  tableName: '1',
  draftLines: draft.draftLines,
  customerName: draft.customerName,
  customerPhone: draft.customerPhone,
  orderNotes: draft.orderNotes,
});
assert.match(note, /2 x Masala Chai/);
assert.match(note, /Extra Ginger/);
assert.match(note, /Less sugar/);
assert.match(note, /Room 4 — terrace/);
assert.match(note, /STATUS: NOT SENT TO KITCHEN/);

assert.equal(saveServerAppDraft(storage, user.id, null), true);
assert.equal(loadServerAppDraft(storage, user.id), null);
assert.deepEqual(loadServerAppCatalog(storage, user.id)?.products, catalog.products);
assert.equal(loadServerAppLocalUser(storage, user.id)?.id, user.id);
assert.equal(loadServerAppDraft(storage, 'other-staff'), null);

console.log('Server App local persistence and copy-note tests passed.');
