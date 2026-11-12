export function getServerAppTimestamp(): string {
  return new Date().toISOString();
}

export interface ServerAppLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface ServerAppLocalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permission_ids?: string[];
}
export interface ServerAppLocalCatalog {
  savedAt: string;
  categories: unknown[];
  products: unknown[];
  tables: unknown[];
}
export interface ServerAppPersistedSendAttempt<TLine = unknown> {
  signature: string;
  nonce: string;
  snapshot: {
    tableId: string;
    requestTableId?: string;
    tableName: string | undefined;
    orderId: number | null;
    orderCustomer: { id?: string; name: string; phone?: string } | null | undefined;
    existingItemIds: Array<number | string>;
    draftLines: TLine[];
    customerName: string;
    customerPhone: string;
    orderNotes: string;
    roomNumber?: string;
  };
}
export interface ServerAppLocalDraft<TLine = unknown> {
  tableId: string;
  tableName?: string;
  draftLines: TLine[];
  customerName: string;
  customerPhone: string;
  orderNotes: string;
  roomNumber?: string;
  savedAt: string;
  attempt?: ServerAppPersistedSendAttempt<TLine>;
}
interface ServerAppLocalRecord<TLine = unknown> {
  version: 1;
  ownerId: string;
  updatedAt: string;
  user?: ServerAppLocalUser;
  catalog?: ServerAppLocalCatalog;
  draft?: ServerAppLocalDraft<TLine>;
}
const VERSION = 1 as const;
const KEY_PREFIX = 'flocafe:server-app-local:v1:';
function storageKey(userId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(userId)}`;
}
function readRecord<TLine>(
  storage: ServerAppLocalStorage,
  userId: string,
): ServerAppLocalRecord<TLine> | null {
  if (!userId) return null;
  try {
    const raw = storage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServerAppLocalRecord<TLine>>;
    if (parsed.version !== VERSION || parsed.ownerId !== userId) return null;
    return {
      version: VERSION,
      ownerId: userId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      ...(parsed.user?.id === userId ? { user: parsed.user } : {}),
      ...(parsed.catalog &&
      Array.isArray(parsed.catalog.categories) &&
      Array.isArray(parsed.catalog.products) &&
      Array.isArray(parsed.catalog.tables)
        ? { catalog: parsed.catalog }
        : {}),
      ...(parsed.draft &&
      typeof parsed.draft.tableId === 'string' &&
      Array.isArray(parsed.draft.draftLines)
        ? { draft: parsed.draft }
        : {}),
    };
  } catch {
    return null;
  }
}
function writeRecord<TLine>(
  storage: ServerAppLocalStorage,
  record: ServerAppLocalRecord<TLine>,
): boolean {
  const next = { ...record, version: VERSION, updatedAt: new Date().toISOString() };
  try {
    storage.setItem(storageKey(record.ownerId), JSON.stringify(next));
    return true;
  } catch {
    if (!next.catalog) return false;
    try {
      storage.setItem(storageKey(record.ownerId), JSON.stringify({ ...next, catalog: undefined }));
      return true;
    } catch {
      return false;
    }
  }
}
export function loadServerAppLocalUser(
  storage: ServerAppLocalStorage,
  userId: string,
): ServerAppLocalUser | null {
  return readRecord(storage, userId)?.user ?? null;
}
export function saveServerAppLocalUser(
  storage: ServerAppLocalStorage,
  user: ServerAppLocalUser,
): boolean {
  if (!user?.id) return false;
  const record = readRecord(storage, user.id) ?? {
    version: VERSION,
    ownerId: user.id,
    updatedAt: '',
  };
  return writeRecord(storage, { ...record, user });
}
export function loadServerAppCatalog(
  storage: ServerAppLocalStorage,
  userId: string,
): ServerAppLocalCatalog | null {
  return readRecord(storage, userId)?.catalog ?? null;
}
export function saveServerAppCatalog(
  storage: ServerAppLocalStorage,
  userId: string,
  catalog: Omit<ServerAppLocalCatalog, 'savedAt'>,
): boolean {
  if (!userId) return false;
  const record = readRecord(storage, userId) ?? {
    version: VERSION,
    ownerId: userId,
    updatedAt: '',
  };
  return writeRecord(storage, {
    ...record,
    catalog: { ...catalog, savedAt: new Date().toISOString() },
  });
}
export function loadServerAppDraft<TLine = unknown>(
  storage: ServerAppLocalStorage,
  userId: string,
): ServerAppLocalDraft<TLine> | null {
  return readRecord<TLine>(storage, userId)?.draft ?? null;
}
export function saveServerAppDraft<TLine>(
  storage: ServerAppLocalStorage,
  userId: string,
  draft: ServerAppLocalDraft<TLine> | null,
): boolean {
  if (!userId) return false;
  const record = readRecord<TLine>(storage, userId) ?? {
    version: VERSION,
    ownerId: userId,
    updatedAt: '',
  };
  const hasWork =
    !!draft &&
    (draft.draftLines.length > 0 ||
      Boolean(draft.orderNotes.trim()) ||
      Boolean(draft.roomNumber?.trim()) ||
      Boolean(draft.customerName.trim()) ||
      Boolean(draft.customerPhone.trim()) ||
      Boolean(draft.attempt));
  if (!hasWork) {
    const { draft: removed, ...rest } = record;
    return removed ? writeRecord(storage, rest) : true;
  }
  return writeRecord(storage, { ...record, draft: draft! });
}
export function formatServerAppManualTicketTemplate(preparedAt?: string): string {
  const lines = ['FLO CAFE — MANUAL WAITER TICKET', 'STATUS: MANUAL NOTE — NOT SENT TO KITCHEN'];
  if (preparedAt) lines.push(`Prepared: ${preparedAt}`);
  lines.push(
    '',
    'TABLE / ROOM: ______________________________',
    'GUEST NAME: _________________________________',
    'GUEST COUNT: ______',
    'PHONE / ROOM NUMBER: ________________________',
    'STAFF: ______________________________________',
    '',
    'ITEMS (write quantity, modifiers and instructions)',
    '1. ______________________________  QTY: ____',
    '   MODIFIERS: ________________________________',
    '   PREPARATION NOTE: _________________________',
    '2. ______________________________  QTY: ____',
    '   MODIFIERS: ________________________________',
    '   PREPARATION NOTE: _________________________',
    '3. ______________________________  QTY: ____',
    '   MODIFIERS: ________________________________',
    '   PREPARATION NOTE: _________________________',
    '4. ______________________________  QTY: ____',
    '   MODIFIERS: ________________________________',
    '   PREPARATION NOTE: _________________________',
    '',
    'ORDER NOTES: _________________________________',
    '',
    'KITCHEN HANDOFF: Show this note to kitchen staff or tell them verbally.',
    'IMPORTANT: This is not a FloCafe order, does not reserve a table, and has not printed.',
    'WHEN FLOCAFE RETURNS: Verify the table/current order on the Windows hub, then enter and send once.',
  );
  return lines.join('\n');
}

export function formatServerAppTicketNote(input: {
  tableName?: string;
  tableId?: string;
  draftLines: Array<{
    quantity: number;
    product?: { name?: string };
    variant?: { name?: string } | null;
    addons?: Array<{ name?: string; quantity?: number }>;
    special_instructions?: string;
  }>;
  customerName?: string;
  customerPhone?: string;
  orderNotes?: string;
  roomNumber?: string;
  savedAt?: string;
}): string {
  const lines = [
    'FLO CAFE — WAITER TICKET NOTE',
    `Table: ${input.tableName || input.tableId || 'Not selected'}`,
  ];
  if (input.roomNumber?.trim()) lines.push(`Room: ${input.roomNumber.trim()}`);
  if (input.customerName?.trim()) lines.push(`Guest: ${input.customerName.trim()}`);
  if (input.customerPhone?.trim()) lines.push(`Phone: ${input.customerPhone.trim()}`);
  if (input.savedAt) lines.push(`Saved: ${input.savedAt}`);
  lines.push('', 'ITEMS');
  if (input.draftLines.length === 0) lines.push('(No menu items added — see notes below)');
  for (const item of input.draftLines) {
    const title = `${item.quantity} x ${item.product?.name || 'Menu item'}${item.variant?.name ? ` (${item.variant.name})` : ''}`;
    lines.push(title);
    for (const addon of item.addons || [])
      lines.push(
        `  + ${addon.name || 'Add-on'}${(addon.quantity || 1) > 1 ? ` x${addon.quantity}` : ''}`,
      );
    if (item.special_instructions?.trim())
      lines.push(`  Note: ${item.special_instructions.trim()}`);
  }
  if (input.orderNotes?.trim()) lines.push('', 'ORDER NOTES', input.orderNotes.trim());
  lines.push(
    '',
    'STATUS: NOT SENT TO KITCHEN',
    'Review and explicitly send from the Server App after reconnecting to the Windows hub.',
  );
  return lines.join('\n');
}
