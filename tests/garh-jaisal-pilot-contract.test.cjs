const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profileSource = fs.readFileSync(path.join(root, 'shared/deployment-profiles.ts'), 'utf8');

assert.match(profileSource, /taxRegistered:\s*null/);
assert.match(profileSource, /kdsEnabled:\s*false/);
assert.match(profileSource, /paymentMethods:\s*\['UPI'\]/);
assert.doesNotMatch(profileSource, /paymentMethods:\s*\[[^\]]*['"]Cash['"][^\]]*['"]Card['"]/);
assert.match(
  profileSource,
  /rolePermissionOverrides:[\s\S]*?role:\s*'manager',[\s\S]*?permissionId:\s*'cash\.day-close'/,
);

const sidebarSource = fs.readFileSync(
  path.join(root, 'frontend/src/components/layout/Sidebar.tsx'),
  'utf8',
);
assert.match(sidebarSource, /href:\s*'\/day-close'[\s\S]*?permission:\s*'cash.day-close'/);
const dayClosePageSource = fs.readFileSync(
  path.join(root, 'frontend/src/app/(dashboard)/day-close/page.tsx'),
  'utf8',
);
assert.ok(dayClosePageSource.includes("tenantCan(currentTenant, 'cash.day-close')"));
assert.ok(dayClosePageSource.includes('<CashCloseModal model={cashClose} />'));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(
  packageJson.scripts['dev:garh-jaisal-pilot'],
  'FLO_PROFILE=garh-jaisal-pilot npm run dev',
);
assert.notEqual(
  packageJson.scripts['dev:garh-jaisal-test'],
  packageJson.scripts['dev:garh-jaisal-pilot'],
);

const auth = fs.readFileSync(path.join(root, 'main/routes/auth.ts'), 'utf8');
assert.ok(auth.includes("const resolvedTaxRegistered = isGarhJaisalSetup ? 'pending'"));
const seed = fs.readFileSync(path.join(root, 'main/setup/seed-data.ts'), 'utf8');
assert.ok(seed.includes('GARH_JAISAL_PROFILE.paymentMethods.forEach'));

const panel = fs.readFileSync(
  path.join(root, 'frontend/src/components/settings/TaxConfigurationPanel.tsx'),
  'utf8',
);
assert.ok(panel.includes('data-gst-registration-status="pending"'));
assert.ok(panel.includes("taxRegistrationResponse.data.setting?.value === 'pending'"));

const firstRun = fs.readFileSync(path.join(root, 'tests/first-run-setup.test.ts'), 'utf8');
assert.ok(firstRun.includes("setting('tax_registered'),"));
assert.ok(firstRun.includes("setting('taxes_enabled'),"));
assert.ok(firstRun.includes("WHERE pack.country = 'IN'"));
assert.ok(firstRun.includes("[{ name: 'UPI' }]"));

const isolation = fs.readFileSync(
  path.join(root, 'tests/local-profile-isolation.test.cjs'),
  'utf8',
);
assert.ok(isolation.includes("packageJson.scripts['dev:garh-jaisal-pilot']"));
assert.ok(isolation.includes('app.requestSingleInstanceLock()'));

console.log('M5 Garh Jaisal onboarding contracts passed');
