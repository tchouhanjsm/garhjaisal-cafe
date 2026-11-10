'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Edit2, History, RefreshCw, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useAmountFormat } from '@/hooks/useAmountFormat';
import { roundCurrencyValue } from '@/lib/currency-input';
import { tenantCan } from '@/lib/permissions';
import type { Category, Product } from '@/lib/types';

type StatusFilter = 'all' | 'active' | 'inactive';
type SortMode = 'name' | 'price-asc' | 'price-desc';
type BulkPriceMode =
  | 'increase_percent'
  | 'decrease_percent'
  | 'increase_amount'
  | 'decrease_amount'
  | 'set_price';
type BulkDialog = 'price' | 'availability' | null;

type ProductDraft = {
  name: string;
  category_id: string;
  price: string;
  is_active: boolean;
};

type EditableSnapshot = {
  name: string;
  category_id: string | null;
  price: number;
  is_active: boolean;
};

type MenuStudioChange = {
  id: string;
  expected_updated_at: string;
  expected: EditableSnapshot;
  patch: Partial<EditableSnapshot>;
};

type AuditEntry = {
  id: number;
  batch_id: string;
  product_id: string;
  actor_name?: string | null;
  action: string;
  before: EditableSnapshot | null;
  after: EditableSnapshot | null;
  created_at: string;
};

const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand';

function productSnapshot(product: Product): EditableSnapshot {
  return {
    name: product.name,
    category_id: product.category_id,
    price: Number(product.price),
    is_active: Boolean(product.is_active),
  };
}

function errorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

function errorMessage(error: unknown): string | undefined {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
}

export default function MenuStudioPage() {
  const router = useRouter();
  const tenant = useAuthStore((state) => state.currentTenant);
  const canManage = tenantCan(tenant, 'catalog.manage');
  const formatCurrency = useFormatCurrency();
  const amountFormat = useAmountFormat();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [bulkPriceMode, setBulkPriceMode] = useState<BulkPriceMode>('increase_percent');
  const [bulkAmount, setBulkAmount] = useState('10');
  const [bulkAvailability, setBulkAvailability] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyEntries, setHistoryEntries] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const [productResponse, categoryResponse] = await Promise.all([
        api.get('/products?include_inactive_variants=true'),
        api.get('/categories'),
      ]);
      setProducts((productResponse.data.products as Product[]) || []);
      setCategories((categoryResponse.data.categories as Category[]) || []);
    } catch (error) {
      toast.error(errorMessage(error) || 'Could not load the menu catalog');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    const controller = new AbortController();
    void Promise.all([
      api.get('/products?include_inactive_variants=true', { signal: controller.signal }),
      api.get('/categories', { signal: controller.signal }),
    ])
      .then(([productResponse, categoryResponse]) => {
        if (!active) return;
        setProducts((productResponse.data.products as Product[]) || []);
        setCategories((categoryResponse.data.categories as Category[]) || []);
      })
      .catch((error: unknown) => {
        if (
          active &&
          !(error instanceof Error && (error.name === 'CanceledError' || error.name === 'AbortError'))
        ) {
          toast.error(errorMessage(error) || 'Could not load the menu catalog');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [canManage]);

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = products.filter((product) => {
      const matchesQuery =
        !normalizedQuery ||
        product.name.toLocaleLowerCase().includes(normalizedQuery) ||
        (product.sku || '').toLocaleLowerCase().includes(normalizedQuery) ||
        (product.barcode || '').toLocaleLowerCase().includes(normalizedQuery);
      const matchesCategory =
        categoryFilter === 'all' || (product.category_id || 'uncategorized') === categoryFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? product.is_active : !product.is_active);
      return matchesQuery && matchesCategory && matchesStatus;
    });
    return filtered.sort((left, right) => {
      if (sortMode === 'price-asc') return Number(left.price) - Number(right.price);
      if (sortMode === 'price-desc') return Number(right.price) - Number(left.price);
      return left.name.localeCompare(right.name);
    });
  }, [products, query, categoryFilter, statusFilter, sortMode]);

  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIds.includes(product.id)),
    [products, selectedIds],
  );

  const amountValue = bulkAmount.trim() === '' ? null : Number(bulkAmount);
  const pricePreview = useMemo(() => {
    if (amountValue === null || !Number.isFinite(amountValue) || amountValue < 0) return [];
    return selectedProducts.map((product) => {
      const currentPrice = Number(product.price);
      let nextPrice = currentPrice;
      switch (bulkPriceMode) {
        case 'increase_percent':
          nextPrice = currentPrice * (1 + amountValue / 100);
          break;
        case 'decrease_percent':
          nextPrice = currentPrice * (1 - amountValue / 100);
          break;
        case 'increase_amount':
          nextPrice = currentPrice + amountValue;
          break;
        case 'decrease_amount':
          nextPrice = currentPrice - amountValue;
          break;
        case 'set_price':
          nextPrice = amountValue;
          break;
      }
      return {
        product,
        before: currentPrice,
        after: roundCurrencyValue(
          Math.max(0, nextPrice),
          amountFormat.currencyFractionDigits,
        ),
      };
    });
  }, [selectedProducts, bulkPriceMode, amountValue, amountFormat.currencyFractionDigits]);

  const allVisibleSelected =
    visibleProducts.length > 0 &&
    visibleProducts.every((product) => selectedIds.includes(product.id));

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const visibleIds = new Set(visibleProducts.map((product) => product.id));
        return current.filter((id) => !visibleIds.has(id));
      }
      return [...new Set([...current, ...visibleProducts.map((product) => product.id)])];
    });
  };

  const beginEdit = (product: Product) => {
    setEditingId(product.id);
    setDraft({
      name: product.name,
      category_id: product.category_id || '',
      price: String(product.price),
      is_active: Boolean(product.is_active),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (product: Product) => {
    if (!draft) return;
    const price = Number(draft.price);
    if (!draft.name.trim() || !Number.isFinite(price) || price < 0) {
      toast.error('Enter a product name and a valid non-negative price');
      return;
    }

    const patch: Partial<EditableSnapshot> = {};
    const expected = productSnapshot(product);
    const nextName = draft.name.trim();
    const nextCategory = draft.category_id || null;
    const nextPrice = roundCurrencyValue(price, amountFormat.currencyFractionDigits);
    if (nextName !== expected.name) patch.name = nextName;
    if (nextCategory !== expected.category_id) patch.category_id = nextCategory;
    if (nextPrice !== expected.price) patch.price = nextPrice;
    if (draft.is_active !== expected.is_active) patch.is_active = draft.is_active;

    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }

    setSavingId(product.id);
    try {
      await api.post('/menu-studio/updates', {
        changes: [
          {
            id: product.id,
            expected_updated_at: product.updated_at,
            expected,
            patch,
          } satisfies MenuStudioChange,
        ],
      });
      toast.success('Menu item saved');
      cancelEdit();
      await loadData(true);
    } catch (error) {
      if (errorStatus(error) === 409) {
        toast.error('This item changed elsewhere. The menu has been refreshed; review it and try again.');
        cancelEdit();
        await loadData(true);
      } else {
        toast.error(errorMessage(error) || 'Could not save this menu item');
      }
    } finally {
      setSavingId(null);
    }
  };

  const confirmBulkPrice = async () => {
    if (pricePreview.length !== selectedProducts.length || pricePreview.length === 0) return;
    setBulkSaving(true);
    const changes: MenuStudioChange[] = pricePreview.map(({ product, after }) => ({
      id: product.id,
      expected_updated_at: product.updated_at,
      expected: productSnapshot(product),
      patch: { price: after },
    }));
    try {
      await api.post('/menu-studio/updates', { changes });
      toast.success(`Updated prices for ${changes.length} menu items`);
      setSelectedIds([]);
      setBulkDialog(null);
      await loadData(true);
    } catch (error) {
      if (errorStatus(error) === 409) {
        toast.error('Some selected items changed after the preview. No prices were changed; reload and review again.');
        await loadData(true);
      } else {
        toast.error(errorMessage(error) || 'Could not apply the price changes');
      }
    } finally {
      setBulkSaving(false);
    }
  };

  const confirmBulkAvailability = async () => {
    if (selectedProducts.length === 0) return;
    setBulkSaving(true);
    const changes: MenuStudioChange[] = selectedProducts.map((product) => ({
      id: product.id,
      expected_updated_at: product.updated_at,
      expected: productSnapshot(product),
      patch: { is_active: bulkAvailability },
    }));
    try {
      await api.post('/menu-studio/updates', { changes });
      toast.success(
        `Marked ${changes.length} items ${bulkAvailability ? 'available' : 'unavailable'}`,
      );
      setSelectedIds([]);
      setBulkDialog(null);
      await loadData(true);
    } catch (error) {
      if (errorStatus(error) === 409) {
        toast.error('Some selected items changed. No availability changes were applied; reload and review again.');
        await loadData(true);
      } else {
        toast.error(errorMessage(error) || 'Could not update availability');
      }
    } finally {
      setBulkSaving(false);
    }
  };

  const openHistory = async (product: Product) => {
    setHistoryProduct(product);
    setHistoryEntries([]);
    setHistoryLoading(true);
    try {
      const response = await api.get(
        `/menu-studio/audit?product_id=${encodeURIComponent(product.id)}&limit=30`,
      );
      setHistoryEntries((response.data.entries as AuditEntry[]) || []);
    } catch (error) {
      toast.error(errorMessage(error) || 'Could not load item history');
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8">
        <h1 className="text-xl font-semibold">Menu Studio</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need catalog management permission to edit the menu.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/products')}>
          <ArrowLeft className="me-2 size-4" /> Back to Products
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="dashboard-scroll-shell flex h-full min-h-0 flex-col">
      <div className="mb-5 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.push('/products')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Products
          </button>
          <h1 className="text-2xl font-bold text-foreground">Menu Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update the live menu safely. Existing order bills keep their original item and price snapshots.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadData(true)} disabled={refreshing}>
          <RefreshCw className={`me-2 size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="mb-4 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Menu items</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{products.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Available</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {products.filter((product) => product.is_active).length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Unavailable</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {products.filter((product) => !product.is_active).length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Selected</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{selectedIds.length}</p>
        </div>
      </div>

      <div className="mb-3 flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by item name, SKU or barcode"
            aria-label="Search menu items"
            className={`${inputClass} ps-9`}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          aria-label="Filter by category"
          className={inputClass + ' lg:w-52'}
        >
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          aria-label="Filter by availability"
          className={inputClass + ' lg:w-40'}
        >
          <option value="all">All statuses</option>
          <option value="active">Available</option>
          <option value="inactive">Unavailable</option>
        </select>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          aria-label="Sort menu items"
          className={inputClass + ' lg:w-44'}
        >
          <option value="name">Name A–Z</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <span className="me-auto text-sm text-muted-foreground">
          {visibleProducts.length} of {products.length} items
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={selectedIds.length === 0}
          onClick={() => {
            setBulkPriceMode('increase_percent');
            setBulkAmount('10');
            setBulkDialog('price');
          }}
        >
          Bulk price
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={selectedIds.length === 0}
          onClick={() => {
            setBulkAvailability(true);
            setBulkDialog('availability');
          }}
        >
          Bulk availability
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="w-10 p-3 text-center">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible menu items"
                />
              </th>
              <th className="p-3 text-start text-xs font-semibold uppercase text-muted-foreground">Item</th>
              <th className="p-3 text-start text-xs font-semibold uppercase text-muted-foreground">Category</th>
              <th className="p-3 text-end text-xs font-semibold uppercase text-muted-foreground">Base price</th>
              <th className="p-3 text-center text-xs font-semibold uppercase text-muted-foreground">Availability</th>
              <th className="p-3 text-center text-xs font-semibold uppercase text-muted-foreground">Variants / add-ons</th>
              <th className="p-3 text-end text-xs font-semibold uppercase text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleProducts.map((product) => {
              const rowDraft = editingId === product.id ? draft : null;
              const isEditing = rowDraft !== null;
              const selected = selectedIds.includes(product.id);
              return (
                <tr key={product.id} className={selected ? 'bg-muted/50' : 'hover:bg-muted/30'}>
                  <td className="p-3 text-center align-middle">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={isEditing}
                      onChange={() => toggleSelected(product.id)}
                      aria-label={`Select ${product.name}`}
                    />
                  </td>
                  <td className="p-3 align-middle">
                    {rowDraft ? (
                      <div className="min-w-48">
                        <input
                          value={rowDraft.name}
                          onChange={(event) => setDraft({ ...rowDraft, name: event.target.value })}
                          aria-label={`Name for ${product.name}`}
                          className={inputClass}
                          maxLength={120}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {product.sku ? `SKU: ${product.sku}` : 'No SKU'}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-medium text-foreground">{product.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {product.sku ? `SKU: ${product.sku}` : product.barcode ? `Barcode: ${product.barcode}` : 'No SKU'}
                        </p>
                      </div>
                    )}
                  </td>
                  <td className="p-3 align-middle">
                    {rowDraft ? (
                      <select
                        value={rowDraft.category_id}
                        onChange={(event) => setDraft({ ...rowDraft, category_id: event.target.value })}
                        aria-label={`Category for ${product.name}`}
                        className={inputClass}
                      >
                        <option value="">Uncategorized</option>
                        {categories.filter((category) => category.is_active || category.id === product.category_id).map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted-foreground">{product.category?.name || 'Uncategorized'}</span>
                    )}
                  </td>
                  <td className="p-3 text-end align-middle">
                    {rowDraft ? (
                      <input
                        type="number"
                        min="0"
                        step={10 ** -amountFormat.currencyFractionDigits}
                        value={rowDraft.price}
                        onChange={(event) => setDraft({ ...rowDraft, price: event.target.value })}
                        aria-label={`Price for ${product.name}`}
                        className={inputClass + ' min-w-28 text-end'}
                      />
                    ) : (
                      <div>
                        <p className="font-semibold tabular-nums">{formatCurrency(Number(product.price))}</p>
                        {(product.variants?.length || 0) > 0 && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">Variant prices are separate</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-center align-middle">
                    {rowDraft ? (
                      <select
                        value={rowDraft.is_active ? 'available' : 'unavailable'}
                        onChange={(event) => setDraft({ ...rowDraft, is_active: event.target.value === 'available' })}
                        aria-label={`Availability for ${product.name}`}
                        className={inputClass}
                      >
                        <option value="available">Available</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                    ) : (
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${product.is_active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                        {product.is_active ? 'Available' : 'Unavailable'}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-center align-middle text-xs text-muted-foreground">
                    <div>{product.variants?.length || 0} variants</div>
                    <div>{product.addon_groups?.length || 0} add-on groups</div>
                  </td>
                  <td className="p-3 text-end align-middle">
                    {rowDraft ? (
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" onClick={() => void saveEdit(product)} disabled={savingId === product.id}>
                          <Check className="me-1 size-3.5" /> {savingId === product.id ? 'Saving' : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={savingId === product.id}>
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => beginEdit(product)} aria-label={`Edit ${product.name}`}>
                          <Edit2 className="me-1 size-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void openHistory(product)} aria-label={`History for ${product.name}`}>
                          <History className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleProducts.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">No menu items match these filters</p>
            <p className="mt-1 text-sm text-muted-foreground">Try another search or clear a filter.</p>
          </div>
        )}
      </div>

      {bulkDialog === 'price' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold">Bulk price change</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Preview every selected item’s new base price before applying.
                </p>
              </div>
              <button type="button" onClick={() => setBulkDialog(null)} aria-label="Close price preview">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-[1fr_12rem]">
              <label className="text-sm font-medium">
                Price operation
                <select
                  value={bulkPriceMode}
                  onChange={(event) => setBulkPriceMode(event.target.value as BulkPriceMode)}
                  className={inputClass + ' mt-1'}
                >
                  <option value="increase_percent">Increase by percentage</option>
                  <option value="decrease_percent">Decrease by percentage</option>
                  <option value="increase_amount">Increase by fixed amount</option>
                  <option value="decrease_amount">Decrease by fixed amount</option>
                  <option value="set_price">Set the same price</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                {bulkPriceMode.includes('percent') ? 'Percentage' : 'Amount'}
                <input
                  type="number"
                  min="0"
                  step={bulkPriceMode.includes('percent') ? '0.1' : String(10 ** -amountFormat.currencyFractionDigits)}
                  value={bulkAmount}
                  onChange={(event) => setBulkAmount(event.target.value)}
                  className={inputClass + ' mt-1'}
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{pricePreview.length} items in preview</span>
                <span className="text-muted-foreground">No changes are saved yet</span>
              </div>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">Item</th>
                    <th className="p-2 text-end">Current</th>
                    <th className="p-2 text-end">New price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pricePreview.map(({ product, before, after }) => (
                    <tr key={product.id}>
                      <td className="p-2">{product.name}</td>
                      <td className="p-2 text-end tabular-nums">{formatCurrency(before)}</td>
                      <td className="p-2 text-end font-semibold tabular-nums">{formatCurrency(after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pricePreview.length !== selectedProducts.length && (
                <p className="py-4 text-sm text-destructive">Enter a valid amount to preview the changes.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5">
              <p className="max-w-lg text-xs text-muted-foreground">
                Only base product prices change. Variant and add-on prices remain unchanged.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={bulkSaving}>Cancel</Button>
                <Button onClick={() => void confirmBulkPrice()} disabled={bulkSaving || pricePreview.length === 0 || pricePreview.length !== selectedProducts.length}>
                  {bulkSaving ? 'Applying…' : `Confirm ${pricePreview.length} changes`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bulkDialog === 'availability' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
            <div className="border-b border-border p-5">
              <h2 className="text-lg font-semibold">Bulk availability</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Apply one availability state to {selectedProducts.length} selected menu items.
              </p>
            </div>
            <div className="space-y-3 p-5">
              <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                <input type="radio" checked={bulkAvailability} onChange={() => setBulkAvailability(true)} />
                <span><strong className="block text-sm">Available</strong><span className="text-xs text-muted-foreground">Visible for new POS orders, subject to category availability.</span></span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                <input type="radio" checked={!bulkAvailability} onChange={() => setBulkAvailability(false)} />
                <span><strong className="block text-sm">Unavailable</strong><span className="text-xs text-muted-foreground">Hidden from new POS item selection.</span></span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setBulkDialog(null)} disabled={bulkSaving}>Cancel</Button>
              <Button onClick={() => void confirmBulkAvailability()} disabled={bulkSaving || selectedProducts.length === 0}>
                {bulkSaving ? 'Saving…' : 'Confirm availability'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {historyProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-lg font-semibold">Edit history</h2>
                <p className="mt-1 text-sm text-muted-foreground">{historyProduct.name}</p>
              </div>
              <button type="button" onClick={() => setHistoryProduct(null)} aria-label="Close edit history">
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
              {historyLoading ? (
                <p className="text-sm text-muted-foreground">Loading history…</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Menu Studio changes recorded for this item.</p>
              ) : historyEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{entry.action.replaceAll('_', ' ')}</span>
                    <span className="text-xs text-muted-foreground">{new Date(entry.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">By {entry.actor_name || entry.actor_user_id}</p>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-muted p-2">
                      <p className="mb-1 font-semibold">Before</p>
                      <p>{entry.before?.name || '—'}</p>
                      <p>{entry.before ? formatCurrency(entry.before.price) : '—'}</p>
                      <p>{entry.before?.is_active ? 'Available' : 'Unavailable'}</p>
                    </div>
                    <div className="rounded-lg bg-muted p-2">
                      <p className="mb-1 font-semibold">After</p>
                      <p>{entry.after?.name || '—'}</p>
                      <p>{entry.after ? formatCurrency(entry.after.price) : '—'}</p>
                      <p>{entry.after?.is_active ? 'Available' : 'Unavailable'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-border p-4">
              <Button variant="outline" onClick={() => setHistoryProduct(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
