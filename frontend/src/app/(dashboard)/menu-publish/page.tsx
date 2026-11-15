'use client';

import { useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { ArrowLeft, CheckCircle2, CloudUpload, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { tenantCan } from '@/lib/permissions';

const subscribeToPlatform = (_onStoreChange: () => void) => () => {};
const getIsMacPlatform = () =>
  typeof navigator !== 'undefined' && /Macintosh|Mac OS X|MacIntel/.test(navigator.userAgent);
const getServerIsMacPlatform = () => false;

type MenuCatalogRow = Record<string, unknown>;

type MenuBundle = {
  format_version: number;
  source: { business_name: string; country: string; currency: string };
  catalog: Record<string, MenuCatalogRow[]>;
  fingerprint: string;
};

type EntitySummary = {
  incoming: number;
  created: number;
  updated: number;
  unchanged: number;
  retained_on_windows: number;
};

type TaxCategoriesResponse = {
  country: string;
  configuration_ready: boolean;
  categories: Array<{ id: string; label: string; rate_percent: number | null }>;
};

function isActiveCatalogRow(row: MenuCatalogRow): boolean {
  return row.is_active === true || row.is_active === 1;
}

function validateInclusiveFivePercentGst(
  bundle: MenuBundle,
  taxCategories: TaxCategoriesResponse,
): string | null {
  if (bundle.source.country !== 'IN') return null;
  if (!taxCategories.configuration_ready) {
    return (
      'Configure the India GST tax pack before publishing. ' +
      'The Mac installation cannot verify the applicable GST category yet.'
    );
  }

  const fivePercentCategoryIds = new Set(
    taxCategories.categories
      .filter((category) => Number(category.rate_percent) === 5)
      .map((category) => category.id),
  );
  if (fivePercentCategoryIds.size === 0) {
    return (
      'The active India tax pack does not expose a 5% GST category. ' +
      'Review the tax-pack configuration before publishing.'
    );
  }

  const products = bundle.catalog.products || [];
  const productsWithIncorrectTax = products.filter(
    (row) =>
      isActiveCatalogRow(row) &&
      row.tax_behavior !== 'exempt' &&
      (!fivePercentCategoryIds.has(String(row.tax_category_id || '')) ||
        row.tax_behavior !== 'inclusive'),
  );

  const addons = bundle.catalog.addons || [];
  const addonsWithIncorrectTax = addons.filter((row) => {
    const inheritsParent =
      row.inherit_parent_tax_category === true || row.inherit_parent_tax_category === 1;
    const categoryMatches =
      inheritsParent || fivePercentCategoryIds.has(String(row.tax_category_id || ''));
    return (
      isActiveCatalogRow(row) &&
      row.tax_behavior !== 'exempt' &&
      (!categoryMatches || row.tax_behavior !== 'inclusive')
    );
  });

  if (productsWithIncorrectTax.length === 0 && addonsWithIncorrectTax.length === 0) return null;

  const describe = (rows: MenuCatalogRow[]) =>
    rows
      .slice(0, 5)
      .map((row) => String(row.name || 'Unnamed item'))
      .join(', ');
  const formatIssues = (label: string, rows: MenuCatalogRow[]) => {
    if (rows.length === 0) return '';
    const names = describe(rows);
    return `${label}: ${names}${rows.length > 5 ? ', …' : ''}`;
  };
  const details = [
    formatIssues('Products', productsWithIncorrectTax),
    formatIssues('Add-ons', addonsWithIncorrectTax),
  ].filter(Boolean);

  const requirement =
    'Publishing is blocked until active taxable products use the India 5% GST category ' +
    'with Inclusive tax behaviour, and active taxable add-ons use Inclusive behaviour ' +
    'plus either inherit the parent category or use that same 5% category.';
  const nextStep =
    'Correct these records in Menu Studio, then preview again. Items explicitly marked ' +
    'Exempt are not changed.';

  return `${requirement} ${details.join('; ')}. ${nextStep}`;
}

type MenuPreview = {
  preview_id: string;
  expires_in_seconds: number;
  summary: {
    categories: EntitySummary;
    products: EntitySummary;
    addon_groups: EntitySummary;
    addons: EntitySummary;
    variants: EntitySummary;
  };
  policy: {
    deletions_applied: boolean;
    windows_only_records_preserved: boolean;
    stock_quantities_preserved: boolean;
    operational_records_changed: boolean;
  };
};

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

function normalizeWindowsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid Windows Server App address.');
  }
  const host = parsed.hostname.toLowerCase();
  const allowedHost = host === 'localhost' || host.endsWith('.local') || isPrivateIpv4(host);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !allowedHost ||
    !parsed.port
  ) {
    throw new Error(
      'Use the Windows private-LAN address from Settings → Mobile Access, including its port (for example, http://192.168.1.25:3002).',
    );
  }
  return parsed.origin.replace(/\/$/, '');
}

function getErrorMessage(error: unknown): string {
  const responseError = (error as { response?: { data?: { error?: string } } })?.response?.data
    ?.error;
  if (responseError) return responseError;
  return error instanceof Error ? error.message : 'Menu publishing failed. Please try again.';
}

function entityLabel(key: string): string {
  const labels: Record<string, string> = {
    categories: 'Categories',
    products: 'Products',
    addon_groups: 'Add-on groups',
    addons: 'Add-ons',
    variants: 'Variants',
  };
  return labels[key] || key;
}

export default function MenuPublishPage() {
  const router = useRouter();
  const tenant = useAuthStore((state) => state.currentTenant);
  const canManage = tenantCan(tenant, 'catalog.manage');
  const isMacClient = useSyncExternalStore(
    subscribeToPlatform,
    getIsMacPlatform,
    getServerIsMacPlatform,
  );
  const [windowsUrl, setWindowsUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [bundle, setBundle] = useState<MenuBundle | null>(null);
  const [preview, setPreview] = useState<MenuPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [published, setPublished] = useState(false);
  const [recoveryBackup, setRecoveryBackup] = useState('');

  const handlePreview = async () => {
    setMessage('');
    setPreview(null);
    setBundle(null);
    setRemoteToken('');
    setPublished(false);
    setRecoveryBackup('');
    let baseUrl = '';
    try {
      baseUrl = normalizeWindowsUrl(windowsUrl);
    } catch (error) {
      setMessage(getErrorMessage(error));
      return;
    }
    if (!email.trim() || !password) {
      setMessage('Enter the Windows owner or manager login details.');
      return;
    }

    setBusy(true);
    try {
      const localExport = await api.get('/menu-publishing/export', { timeout: 60_000 });
      const menuBundle = localExport.data as MenuBundle;
      if (menuBundle.source.country === 'IN') {
        const taxCategoriesResponse = await api.get('/tax/categories', { timeout: 30_000 });
        const taxReadinessError = validateInclusiveFivePercentGst(
          menuBundle,
          taxCategoriesResponse.data as TaxCategoriesResponse,
        );
        if (taxReadinessError) throw new Error(taxReadinessError);
      }

      const login = await axios.post(
        baseUrl + '/api/auth/login',
        { email: email.trim(), password, remember_me: false },
        { timeout: 20_000 },
      );
      const token = String(login.data?.access_token || '');
      setPassword('');
      if (!token) throw new Error('Windows did not return an authentication token.');
      const previewResponse = await axios.post(
        baseUrl + '/api/menu-publishing/preview',
        menuBundle,
        {
          headers: { Authorization: 'Bearer ' + token },
          timeout: 90_000,
        },
      );
      setBundle(menuBundle);
      setRemoteToken(token);
      setPreview(previewResponse.data as MenuPreview);
    } catch (error) {
      setPassword('');
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!preview || !bundle || !remoteToken) return;
    let baseUrl = '';
    try {
      baseUrl = normalizeWindowsUrl(windowsUrl);
    } catch (error) {
      setMessage(getErrorMessage(error));
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const applyResponse = await axios.post(
        baseUrl + '/api/menu-publishing/apply',
        { bundle, preview_id: preview.preview_id },
        {
          headers: { Authorization: 'Bearer ' + remoteToken },
          timeout: 120_000,
        },
      );
      setRecoveryBackup(String(applyResponse.data?.recovery_backup || ''));
      setPublished(true);
      setPreview(null);
      setBundle(null);
      setRemoteToken('');
    } catch (error) {
      setMessage(getErrorMessage(error));
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        setPreview(null);
        setBundle(null);
        setRemoteToken('');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!isMacClient) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8">
        <h1 className="text-xl font-semibold">Publish menu to Windows</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Menu publishing must be initiated from the Mac staging computer. This Windows POS remains
          the production database.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/menu-studio')}>
          <ArrowLeft className="me-2 size-4" /> Back to Menu Studio
        </Button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8">
        <h1 className="text-xl font-semibold">Publish menu to Windows</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need catalog management permission to publish menu changes.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/menu-studio')}>
          <ArrowLeft className="me-2 size-4" /> Back to Menu Studio
        </Button>
      </div>
    );
  }

  const hasPotentialDuplicateMenuRecords = Boolean(
    preview &&
    ((preview.summary.categories.created > 0 &&
      preview.summary.categories.retained_on_windows > 0) ||
      (preview.summary.products.created > 0 && preview.summary.products.retained_on_windows > 0)),
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-5 overflow-auto pb-8">
      <div>
        <button
          type="button"
          onClick={() => router.push('/menu-studio')}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Menu Studio
        </button>
        <h1 className="text-2xl font-bold text-foreground">Publish menu to Windows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send the Mac staging menu to the hotel Windows POS after reviewing the proposed changes.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-muted-foreground" />
          <h2 className="font-semibold">Windows production connection</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the address shown on the Windows computer under Settings → Mobile Access. Sign in with
          a Windows owner or manager account. Your password is used only for sign-in and is not
          saved.
        </p>
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p>
            <strong>GST preflight:</strong> For India, active taxable products must already use the
            5% GST category with <strong>Inclusive</strong> tax behaviour. Taxable add-ons must also
            be Inclusive and either inherit the parent category or use the same 5% category. The
            screen checks this before connecting to Windows; publishing never invents or adds a GST
            rate.
          </p>
          <p>
            <strong>First publication:</strong> Windows should have an empty catalogue or one
            already cloned from this Mac with matching record IDs. Separately created copies of the
            same menu can otherwise become duplicate entries.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Windows Server App URL
            <input
              value={windowsUrl}
              onChange={(event) => setWindowsUrl(event.target.value)}
              placeholder="http://192.168.1.25:3002"
              autoComplete="url"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="block text-sm font-medium">
            Windows account email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@example.com"
              autoComplete="username"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="block text-sm font-medium sm:col-span-2">
            Windows account password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void handlePreview()} disabled={busy}>
            {busy ? (
              <Loader2 className="me-2 size-4 animate-spin" />
            ) : (
              <CloudUpload className="me-2 size-4" />
            )}
            {busy ? 'Preparing preview…' : 'Preview menu changes'}
          </Button>
          <Button variant="outline" onClick={() => router.push('/menu-studio')} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>

      {message && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {message}
        </div>
      )}

      {published && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
          <div>
            <p className="font-semibold">Menu published successfully</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Windows now has the approved catalog changes. Orders, payments, staff, cash sessions
              and stock quantities were not transferred.
            </p>
            {recoveryBackup && (
              <p className="mt-2 text-sm text-muted-foreground">
                Recovery backup created on Windows: <strong>{recoveryBackup}</strong>
              </p>
            )}
          </div>
        </div>
      )}

      {preview && bundle && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Review before publishing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Source: {bundle.source.business_name} · {bundle.source.country} ·{' '}
            {bundle.source.currency}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pe-3 font-medium">Catalog</th>
                  <th className="py-2 px-2 text-end font-medium">New</th>
                  <th className="py-2 px-2 text-end font-medium">Changed</th>
                  <th className="py-2 px-2 text-end font-medium">Unchanged</th>
                  <th className="py-2 ps-2 text-end font-medium">Windows only</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(preview.summary).map(([key, value]) => (
                  <tr key={key} className="border-b border-border last:border-0">
                    <td className="py-2 pe-3 font-medium">{entityLabel(key)}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{value.created}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{value.updated}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{value.unchanged}</td>
                    <td className="py-2 ps-2 text-end tabular-nums">{value.retained_on_windows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasPotentialDuplicateMenuRecords && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
            >
              <strong>Check for possible duplicate menu entries before publishing.</strong>
              <p className="mt-1">
                Records are matched by ID, not by name. Both new Mac records and Windows-only
                records are present, so compare the Windows categories and products with the Mac
                menu. Do not proceed until same-name entries have been reconciled.
              </p>
            </div>
          )}
          <div className="mt-4 space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
            <p>
              <strong>Safe transfer rules</strong>
            </p>
            <p>• Existing Windows-only catalog records are preserved.</p>
            <p>• Missing records are not deleted automatically.</p>
            <p>• Windows stock quantities and inventory balances are preserved.</p>
            <p>• Orders, payments, staff, settings and cash sessions are not transferred.</p>
            <p>• A Windows menu edit after preview cancels the publication.</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleApply()} disabled={busy}>
              {busy ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <CloudUpload className="me-2 size-4" />
              )}
              {busy ? 'Publishing…' : 'Approve and publish to Windows'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setBundle(null);
                setRemoteToken('');
              }}
            >
              Discard preview
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            This preview expires in {Math.max(1, Math.floor(preview.expires_in_seconds / 60))}{' '}
            minutes.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        This tool is intended to publish from the Mac staging profile to the hotel Windows
        production computer. Make future menu edits on Mac after the first publication; manual
        Windows catalog changes are treated as a conflict and stop the next publication.
      </p>
    </div>
  );
}
