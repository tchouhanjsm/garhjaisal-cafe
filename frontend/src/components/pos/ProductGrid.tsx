'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Category, Product, ProductVariant } from '@/lib/types';
import { useCartStore } from '@/store/cart';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import TagBadge from './DietaryBadge';
import { productNeedsCustomizer } from '@/lib/product-variants';
import api from '@/lib/api';
import { useTranslations } from 'use-intl';
import { fractionalQuantityStep, parseDbTimestamp } from '@/lib/utils';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { resolveScannedProduct } from '@/lib/scale-barcode';
import { subscribeToQuickSearch } from '@/lib/quick-search';
import { parseQuantitySearch } from '@/lib/quantity-search';
import {
  sortCategories,
  sortProducts,
  type PosCategorySort,
  type PosItemSort,
} from '@/lib/pos-sort';
import CollapsiblePosChoices from './CollapsiblePosChoices';

/** The category chip shared by both category row modes. */
function CategoryChip({
  categoryName,
  categoryColor,
  isSelected,
  onSelect,
}: {
  categoryName: string;
  categoryColor: string | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const colorClasses = getCategoryColorClasses(categoryColor);
  return (
    <button
      onClick={onSelect}
      title={categoryName}
      className={`max-w-56 truncate px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
        isSelected
          ? colorClasses
            ? `${colorClasses.activeBg} ${colorClasses.activeText}`
            : 'bg-brand text-white'
          : colorClasses
            ? `${colorClasses.bg} ${colorClasses.text} border ${colorClasses.border} hover:opacity-80`
            : 'bg-card text-foreground border border-border hover:bg-muted'
      }`}
    >
      {categoryName}
    </button>
  );
}

/**
 * The category row. The cashier POS opts into the measured collapse row; the
 * Server App keeps the horizontal-scroll layout unchanged.
 */
function CategoryRow({
  className,
  collapse,
  categories,
  selectedCategory,
  setSelectedCategory,
  allLabel,
  resetKey,
}: {
  className: string;
  collapse: boolean;
  categories: Category[];
  selectedCategory: Category['id'] | null;
  setSelectedCategory: (id: Category['id'] | null) => void;
  allLabel: string;
  resetKey: string | null;
}) {
  const allChip = (
    <button
      onClick={() => setSelectedCategory(null)}
      title={collapse ? allLabel : undefined}
      className={`${collapse ? 'min-w-0 truncate ' : ''}px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
        !selectedCategory
          ? 'bg-brand text-white'
          : 'bg-card text-foreground border border-border hover:bg-muted'
      }`}
    >
      {allLabel}
    </button>
  );

  const categoryChips = categories
    .filter((cat) => cat.id != null)
    .map((cat) => ({
      key: String(cat.id),
      render: () => (
        <CategoryChip
          categoryName={cat.name}
          categoryColor={cat.color}
          isSelected={selectedCategory != null && String(selectedCategory) === String(cat.id)}
          onSelect={() => setSelectedCategory(cat.id)}
        />
      ),
    }));

  if (!collapse) {
    return (
      <div
        data-testid="pos-category-row"
        className={`flex flex-nowrap gap-2 ${className} overflow-x-auto`}
      >
        {allChip}
        {categoryChips.map((chip) => (
          <div key={chip.key}>{chip.render()}</div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      <CollapsiblePosChoices
        data-testid="pos-category-row"
        ariaLabel={allLabel}
        resetKey={resetKey}
        choices={[
          { key: 'all', node: allChip },
          ...categoryChips.map((chip) => ({
            key: chip.key,
            node: chip.render(),
          })),
        ]}
        mandatoryKeys={['all', ...(selectedCategory != null ? [String(selectedCategory)] : [])]}
      />
    </div>
  );
}

function isValidProductQuantity(product: Product, quantity: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (Number.isInteger(quantity)) return true;
  const step = fractionalQuantityStep(product);
  return step !== null && Math.abs(quantity / step - Math.round(quantity / step)) <= 1e-8;
}

const CATEGORY_COLORS: Record<
  string,
  {
    bg: string;
    text: string;
    border: string;
    activeBg: string;
    activeText: string;
  }
> = {
  red: {
    bg: 'bg-red-50 dark:bg-red-950/40',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800/40',
    activeBg: 'bg-red-500',
    activeText: 'text-white',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-200 dark:border-orange-800/40',
    activeBg: 'bg-orange-500',
    activeText: 'text-white',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800/40',
    activeBg: 'bg-amber-500',
    activeText: 'text-white',
  },
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/40',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-800/40',
    activeBg: 'bg-yellow-500',
    activeText: 'text-white',
  },
  lime: {
    bg: 'bg-lime-50 dark:bg-lime-950/40',
    text: 'text-lime-700 dark:text-lime-300',
    border: 'border-lime-200 dark:border-lime-800/40',
    activeBg: 'bg-lime-500',
    activeText: 'text-white',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-950/40',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-800/40',
    activeBg: 'bg-green-500',
    activeText: 'text-white',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800/40',
    activeBg: 'bg-emerald-500',
    activeText: 'text-white',
  },
  teal: {
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-800/40',
    activeBg: 'bg-teal-500',
    activeText: 'text-white',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-950/40',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-200 dark:border-cyan-800/40',
    activeBg: 'bg-cyan-500',
    activeText: 'text-white',
  },
  sky: {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-200 dark:border-sky-800/40',
    activeBg: 'bg-sky-500',
    activeText: 'text-white',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800/40',
    activeBg: 'bg-blue-500',
    activeText: 'text-white',
  },
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200 dark:border-indigo-800/40',
    activeBg: 'bg-indigo-500',
    activeText: 'text-white',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-200 dark:border-violet-800/40',
    activeBg: 'bg-violet-500',
    activeText: 'text-white',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-800/40',
    activeBg: 'bg-purple-500',
    activeText: 'text-white',
  },
  fuchsia: {
    bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    text: 'text-fuchsia-700 dark:text-fuchsia-300',
    border: 'border-fuchsia-200 dark:border-fuchsia-800/40',
    activeBg: 'bg-fuchsia-500',
    activeText: 'text-white',
  },
  pink: {
    bg: 'bg-pink-50 dark:bg-pink-950/40',
    text: 'text-pink-700 dark:text-pink-300',
    border: 'border-pink-200 dark:border-pink-800/40',
    activeBg: 'bg-pink-500',
    activeText: 'text-white',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-800/40',
    activeBg: 'bg-rose-500',
    activeText: 'text-white',
  },
};

function getCategoryColorClasses(color: string | null | undefined) {
  if (!color) return null;
  return CATEGORY_COLORS[color.toLowerCase()] || null;
}

type ProductViewMode = 'compact' | 'grid' | 'list';

const productViewPreferenceListeners = new Map<string, Set<() => void>>();
const inMemoryProductViewPreferences = new Map<string, ProductViewMode>();

function readProductViewPreference(key: string): ProductViewMode {
  const inMemoryPreference = inMemoryProductViewPreferences.get(key);
  if (inMemoryPreference) return inMemoryPreference;
  if (typeof window === 'undefined') return 'compact';

  try {
    const saved = window.localStorage.getItem(key);
    if (saved === 'compact' || saved === 'grid' || saved === 'list') return saved;
  } catch {
    // Use the in-memory default when browser storage is unavailable.
  }
  return 'compact';
}

function subscribeToProductViewPreference(key: string, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let listeners = productViewPreferenceListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    productViewPreferenceListeners.set(key, listeners);
  }
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    inMemoryProductViewPreferences.delete(key);
    listener();
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener('storage', handleStorage);
    const currentListeners = productViewPreferenceListeners.get(key);
    currentListeners?.delete(listener);
    if (currentListeners?.size === 0) productViewPreferenceListeners.delete(key);
  };
}

function saveProductViewPreference(key: string, mode: ProductViewMode): void {
  inMemoryProductViewPreferences.set(key, mode);
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, mode);
  } catch {
    // A display preference is optional and must never block product selection.
  }
  productViewPreferenceListeners.get(key)?.forEach((listener) => listener());
}

function getDefaultProductViewPreference(): ProductViewMode {
  return 'compact';
}

interface Props {
  categories: Category[];
  products: Product[];
  selectedCategory: string | null;
  setSelectedCategory: (id: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
  currency: string;
  onProductClick: (product: Product, quantity: number) => void;
  /** A scanned variant goes through the cart customizer, so required add-ons and sold-out gating still apply. */
  onScannedVariant: (product: Product, variant: ProductVariant, quantity: number) => void;
  sidebarOpen?: boolean;
  /** Overrides for hosts that keep their own cart, such as the Server App's tableside draft. */
  cartQuantities?: ReadonlyMap<Product['id'], number>;
  onScaledProduct: (product: Product, quantity: number) => void;
  formatPrice?: (amount: number) => string;
  showImages?: boolean;
  gridClassName?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** Cashier-POS opt-in: measured collapsed category row with a toggle. */
  collapseCategories?: boolean;
  /** Enables the cashier-only compact, image-grid, and list catalogue modes. */
  displayModes?: boolean;
  categorySort?: PosCategorySort;
  itemSort?: PosItemSort;
}

export default function ProductGrid({
  categories,
  products,
  selectedCategory,
  setSelectedCategory,
  search,
  setSearch,
  onProductClick,
  onScannedVariant,
  sidebarOpen = true,
  cartQuantities: cartQuantitiesOverride,
  onScaledProduct,
  formatPrice,
  showImages,
  gridClassName,
  searchPlaceholder,
  disabled = false,
  collapseCategories = false,
  displayModes = false,
  categorySort = 'saved',
  itemSort = 'saved',
}: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cart = useCartStore();
  const { user, currentTenant } = useAuthStore();
  const viewPreferenceKey = `flo.pos.catalog.view:${currentTenant?.id ?? 'default'}:${user?.id ?? 'local'}`;
  const subscribeViewPreference = useCallback(
    (listener: () => void) => subscribeToProductViewPreference(viewPreferenceKey, listener),
    [viewPreferenceKey],
  );
  const getViewPreference = useCallback(
    () => readProductViewPreference(viewPreferenceKey),
    [viewPreferenceKey],
  );
  const viewMode = useSyncExternalStore(
    subscribeViewPreference,
    getViewPreference,
    getDefaultProductViewPreference,
  );
  const setViewMode = useCallback(
    (mode: ProductViewMode) => saveProductViewPreference(viewPreferenceKey, mode),
    [viewPreferenceKey],
  );
  const { showProductImages: showProductImagesSetting } = usePosSettingsStore();
  const showProductImages = showImages ?? showProductImagesSetting;
  const t = useTranslations('pos');
  const validateSelectionQuantity = (product: Product, quantity: number) => {
    if (isValidProductQuantity(product, quantity)) return true;
    toast.error(t('orderQuantityInvalid'));
    return false;
  };
  const tenantFmt = useFormatCurrency();
  const fmt = formatPrice ?? tenantFmt;
  useEffect(() => {
    const focusSearchInput = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    return subscribeToQuickSearch(focusSearchInput);
  }, []);
  const cartStoreQuantities = useMemo(() => {
    const quantities = new Map<Product['id'], number>();
    for (const item of cart.items) {
      quantities.set(item.product.id, (quantities.get(item.product.id) || 0) + item.quantity);
    }
    return quantities;
  }, [cart.items]);
  const cartQuantities = cartQuantitiesOverride ?? cartStoreQuantities;
  const catalogMode: ProductViewMode = displayModes ? viewMode : 'grid';

  const parsedSearch = useMemo(() => parseQuantitySearch(search), [search]);
  const activeQuery = parsedSearch ? parsedSearch.query : search;

  const categoryById = useMemo(
    () => new Map(categories.map((cat) => [String(cat.id), cat])),
    [categories],
  );
  const rootCategories = useMemo(
    () => categories.filter((cat) => cat.is_active !== false && !cat.parent_id),
    [categories],
  );
  const sortedCategories = useMemo(
    () => sortCategories(rootCategories, categorySort),
    [rootCategories, categorySort],
  );
  const selectedCategoryObj = selectedCategory ? categoryById.get(String(selectedCategory)) : null;
  const activeRootId = selectedCategoryObj
    ? selectedCategoryObj.parent_id && categoryById.has(String(selectedCategoryObj.parent_id))
      ? String(selectedCategoryObj.parent_id)
      : String(selectedCategoryObj.id)
    : selectedCategory;
  const activeSubcategoryId =
    selectedCategoryObj?.parent_id && categoryById.has(String(selectedCategoryObj.parent_id))
      ? String(selectedCategoryObj.id)
      : null;

  const activeSubcategories = useMemo(() => {
    if (!activeRootId) return [];
    const children = categories.filter(
      (cat) => cat.is_active !== false && String(cat.parent_id) === String(activeRootId),
    );
    return sortCategories(children, categorySort);
  }, [categories, activeRootId, categorySort]);

  const filterCategoryId = selectedCategory ? activeSubcategoryId || String(activeRootId) : null;

  const sortedProducts = useMemo(() => sortProducts(products, itemSort), [products, itemSort]);

  const filtered = sortedProducts.filter((p) => {
    const matchCat =
      filterCategoryId === null ||
      (p.category_id != null && String(p.category_id) === filterCategoryId);
    const query = activeQuery.trim().toLocaleLowerCase();
    const searchableValues = [
      p.name,
      p.sku,
      p.barcode,
      ...(p.variants ?? []).flatMap((variant) => [variant.name, variant.sku, variant.barcode]),
    ];
    const matchSearch =
      !query ||
      searchableValues.some(
        (value) => typeof value === 'string' && value.toLocaleLowerCase().includes(query),
      );
    return matchCat && matchSearch;
  });

  return (
    <div
      data-testid="pos-product-grid"
      className="flex-1 flex flex-col min-w-0 h-full overflow-hidden"
    >
      <div className="shrink-0 mb-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.nativeEvent?.isComposing ||
                  (e as { isComposing?: boolean }).isComposing ||
                  e.keyCode === 229
                ) {
                  return;
                }
                if (e.key !== 'Enter' || disabled) return;
                const trimmed = search.trim();
                if (!trimmed) return;
                const rawMatch = resolveScannedProduct(trimmed, products);
                const parsedQty = rawMatch ? null : parseQuantitySearch(trimmed);
                const targetCode = parsedQty ? parsedQty.query : trimmed;
                if (!targetCode) return;
                const quantityToAdd = parsedQty ? parsedQty.quantity : 1;
                const match = rawMatch ?? resolveScannedProduct(targetCode, products);
                if (match) {
                  if (match.scaleBarcode) {
                    const matchedQuantity = match.quantity * quantityToAdd;
                    if (!validateSelectionQuantity(match.product, matchedQuantity)) return;
                    onScaledProduct(match.product, matchedQuantity);
                  } else if (match.variant) {
                    if (!validateSelectionQuantity(match.product, quantityToAdd)) return;
                    onScannedVariant(match.product, match.variant, quantityToAdd);
                  } else {
                    if (!validateSelectionQuantity(match.product, quantityToAdd)) return;
                    onProductClick(match.product, quantityToAdd);
                  }
                  setSearch('');
                  return;
                }

                const matchedProduct =
                  filtered.find((p) => p.name.toLowerCase() === targetCode.toLowerCase()) ||
                  (filtered.length === 1 ? filtered[0] : null);

                if (matchedProduct) {
                  if (!validateSelectionQuantity(matchedProduct, quantityToAdd)) return;
                  onProductClick(matchedProduct, quantityToAdd);
                  setSearch('');
                }
              }}
              placeholder={searchPlaceholder ?? `${t('searchProducts')} [/]`}
              data-testid="pos-product-search"
              className="w-full rounded-xl border border-border bg-card py-2 ps-9 pe-8 text-sm outline-none transition-colors focus:border-brand"
            />
            {!search && (
              <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
                /
              </kbd>
            )}
          </div>
          {displayModes && (
            <div
              className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5"
              role="group"
              aria-label="Product display mode"
              data-testid="pos-product-view-modes"
            >
              {([
                { id: 'compact', label: 'Compact', Icon: SlidersHorizontal },
                { id: 'grid', label: 'Images', Icon: LayoutGrid },
                { id: 'list', label: 'List', Icon: List },
              ] as const).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  aria-pressed={catalogMode === id}
                  title={label}
                  onClick={() => setViewMode(id)}
                  className={`inline-flex h-8 w-9 items-center justify-center rounded-md transition-colors ${
                    catalogMode === id
                      ? 'bg-card text-brand shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
        <CategoryRow
          className="pb-1"
          collapse={collapseCategories}
          categories={sortedCategories}
          selectedCategory={activeRootId}
          setSelectedCategory={setSelectedCategory}
          allLabel={t('allCategories')}
          resetKey={
            collapseCategories
              ? cart.customer?.id == null
                ? null
                : String(cart.customer.id)
              : null
          }
        />
        {activeSubcategories.length > 0 && (
          <div
            data-testid="pos-subcategory-row"
            className="mt-1.5 flex flex-nowrap gap-2 overflow-x-auto pb-1"
          >
            {activeSubcategories.map((sub) => (
              <CategoryChip
                key={sub.id}
                categoryName={sub.name}
                categoryColor={sub.color}
                isSelected={activeSubcategoryId === String(sub.id)}
                onSelect={() =>
                  setSelectedCategory(
                    activeSubcategoryId === String(sub.id) ? activeRootId : String(sub.id),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* min-h-0 overrides the content-based automatic minimum size, so a long
          catalog scrolls inside the grid instead of growing past the viewport. */}
      <div
        data-testid="pos-catalog-scroll"
        className="flex-1 min-h-0 overflow-y-auto pb-20 md:pb-0"
      >
        <div
          className={`grid gap-2.5 ${gridClassName ?? (catalogMode === 'list' ? 'grid-cols-1' : catalogMode === 'compact' ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : sidebarOpen ? 'grid-cols-4' : 'grid-cols-5')}`}
          data-testid={`pos-product-catalog-${catalogMode}`}
        >
          {filtered.map((product) => {
            const inCartQty = cartQuantities.get(product.id) || 0;

            return (
              <button
                key={product.id}
                data-testid="pos-product-card"
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  const quantity = parsedSearch?.quantity ?? 1;
                  if (!validateSelectionQuantity(product, quantity)) return;
                  onProductClick(product, quantity);
                }}
                className={`relative flex cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-start transition-all hover:border-brand/40 hover:shadow-sm active:border-brand active:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation ${
                  catalogMode === 'grid'
                    ? 'min-h-36 flex-col p-2.5'
                    : catalogMode === 'compact'
                      ? 'min-h-[84px] items-center gap-2.5 p-2'
                      : 'min-h-16 items-center gap-3 px-2.5 py-2'
                }`}
              >
                {!!product.track_inventory && (
                  <>
                    {product.stock_quantity <= 0 ? (
                      <span className="absolute top-2 start-2 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 shadow-sm border border-red-200 dark:border-red-800/40 pointer-events-none">
                        {t('outOfStock')}
                      </span>
                    ) : product.stock_quantity <= (product.low_stock_threshold || 0) ? (
                      <span className="absolute top-2 start-2 bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 shadow-sm border border-orange-200 dark:border-orange-800/40 pointer-events-none">
                        {t('lowStock')}
                      </span>
                    ) : null}
                  </>
                )}
                {inCartQty > 0 && (
                  <span className="absolute top-0 end-0 bg-brand text-white text-xs w-6 h-6 rounded-es-lg flex items-center justify-center font-bold z-10">
                    {inCartQty}
                  </span>
                )}

                {catalogMode !== 'grid' && (
                  <div
                    className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
                  >
                    <span className="text-sm font-bold text-muted-foreground">
                      {product.name.substring(0, 2).toUpperCase()}
                    </span>
                    {showProductImages && product.has_image && (
                      <img
                        src={`${api.defaults.baseURL}/products/${product.id}/image?t=${product.updated_at ? parseDbTimestamp(product.updated_at).getTime() : 0}`}
                        alt=""
                        className="absolute inset-0 h-full w-full rounded-lg object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                )}

                {showProductImages && catalogMode === 'grid' && (
                  <div className="relative mb-2.5 aspect-square w-full overflow-hidden rounded-lg">
                    {/* Always-visible background tile — no flash when image loads */}
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-muted"
                    >
                      <span className="text-2xl font-bold text-muted-foreground">
                        {product.name.substring(0, 2).toUpperCase()}
                      </span>
                    </div>

                    {/* Image overlays the tile when available */}
                    {product.has_image && (
                      <img
                        src={`${api.defaults.baseURL}/products/${product.id}/image?t=${product.updated_at ? parseDbTimestamp(product.updated_at).getTime() : 0}`}
                        alt={product.name}
                        className="absolute inset-0 w-full h-full object-cover rounded-lg"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}

                    {product.tags && product.tags.length > 0 && (
                      <span className="absolute bottom-1.5 end-1.5 z-10">
                        <TagBadge tag={product.tags[0]} />
                      </span>
                    )}
                  </div>
                )}

                <div className={catalogMode === 'grid' ? 'min-w-0 w-full' : 'min-w-0 flex-1'}>
                  <h3 className={`font-medium leading-snug text-foreground ${
                    catalogMode === 'grid' ? 'line-clamp-2 text-sm' : 'line-clamp-2 text-xs sm:text-sm'
                  }`}>
                    {product.name}
                  </h3>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <p className="font-bold text-brand">{fmt(Number(product.price))}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      {(catalogMode !== 'grid' || !showProductImages) && product.tags && product.tags.length > 0 && (
                        <TagBadge tag={product.tags[0]} />
                      )}
                      {productNeedsCustomizer(product) && (
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground"
                          title={t('customisable')}
                          aria-label={t('customisable')}
                        >
                          <SlidersHorizontal size={14} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}