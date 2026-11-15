# Mac-to-Windows menu publishing

Flo Cafe can publish a prepared menu from a Mac staging installation to the hotel Windows production POS.

## Operating model

- Mac is the menu preparation source.
- Windows remains the only production database for restaurant service.
- The captain's phone continues to connect to the Windows Server App.
- Publishing transfers catalog data only. It is not a database restore or a general device synchronization feature.

## Before publishing

1. Make sure the Mac and Windows computers are on the same trusted private LAN.
2. On Windows, open **Settings → Mobile Access** and copy the Server App URL shown by Flo Cafe.
3. On Windows, confirm the restaurant name, country and currency match the Mac staging profile.
4. Create a fresh Windows database backup before the first publication.
5. Do not expose the Server App port to the public internet or use this flow over untrusted public Wi-Fi.

The Mac publishing screen asks for a Windows owner or manager login. The password is used only for the login request and is not saved. The resulting Windows session token is kept only in the active page's memory.

## Publish

1. On the Mac, open **Menu Studio → Publish to Windows**.
2. Enter the Windows Server App URL, then sign in with a Windows owner or manager account.
3. Select **Preview menu changes**.
4. Review the proposed category, product, add-on-group, add-on and variant changes.
5. Select **Approve and publish to Windows** only after confirming the summary.

The preview expires after ten minutes. Generate a fresh preview if it expires or if the Windows catalog changes before approval.

## Data included

The bundle contains categories, products, product images, add-on groups, add-ons, product variants and their category/product assignments. The bundle is versioned and includes a SHA-256 fingerprint. Windows validates the package, restaurant identity, referenced records and tax categories before applying it.

## Data deliberately excluded

Publishing does not transfer orders, order items, bills, payments, refunds, customers, staff, permissions, cash sessions, day-close records, restaurant settings or tax-pack definitions.

Windows-local inventory tracking configuration, stock quantities, reorder thresholds and inventory ledger history remain on Windows. Missing Mac records are not deleted from Windows. This avoids accidental deletion of Windows-only catalog items, but it means removal/cleanup must be reviewed separately.

## Conflict handling

The first successful publication establishes a Windows catalog baseline. Later publications are blocked if the Windows catalog has been edited outside the Mac publishing flow. This is deliberate: review and reconcile the Windows change on Mac before publishing again. A change made on Windows after a preview also invalidates that preview.

Each successful publication records an audit event with the publishing user, timestamps, fingerprints and catalog counts. The catalogue apply runs as one SQLite transaction; a validation or database error rolls back the full apply.

## Deployment

This feature requires a new Flo Cafe build on both the Mac and Windows computers. The current installed Windows pilot does not gain the new feature until a reviewed PR is merged and a new unsigned Windows pilot installer is built and installed.
