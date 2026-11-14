# Local restaurant deployment profiles

FloCafe stores the database and application state in Electron's selected `userData` directory. The `FLO_PROFILE` environment variable selects a named directory before Electron initializes logging, the database, and backups. Profile names are validated and cannot contain filesystem paths.

## Garh Jaisal development and pilot

From the repository root, use one profile at a time:

| Purpose | Command | Profile data |
| --- | --- | --- |
| Development and testing | `npm run dev:garh-jaisal-test` | `garh-jaisal-test` |
| Garh Jaisal restaurant pilot | `npm run dev:garh-jaisal-pilot` | `garh-jaisal-pilot` |

On macOS, both paths are below Electron's FloCafe application support directory in `profiles/<profile>`. Each profile has its own `flo.db`, settings, first-run marker, logs, replacement recovery files, and local backups. Do not copy a development database or backup into the pilot profile.

The development command uses a separate profile from the pilot, so test users, menu fixtures, orders, and settings remain separate. Configure each profile independently. The pilot profile must be initialized using the Garh Jaisal deployment preset and the owner's real administrator credentials. Do not seed sample menu prices, staff users, or PINs into it.

## Process boundary

The Electron application retains its existing application-wide single-instance lock and the development command rebuilds shared `dist` output and restarts the local service ports. Therefore, these commands are **sequential profiles, not two concurrently running app processes**. Close the running app completely before launching the other profile. This is the supported safe option without changing the lock and port ownership model.

Do not start two builds from the same working tree at once. Running two app processes would require a separately approved change to the single-instance lock and service-port allocation. The profile paths alone do not make concurrent execution safe.

The waiter/captain Server App runs in a phone browser and talks to the selected Mac host over the local Wi-Fi API. It does not open the SQLite file. Keep the host app running on the pilot profile while the waiter uses it. Keep the Mac and phone on the restaurant's trusted local network.

## First-run setup

1. Launch `npm run dev:garh-jaisal-pilot`.
2. Select the Garh Jaisal first-run preset.
3. The preset configures India, INR, `Asia/Kolkata`, English, FineDine/postpaid service, ten tables, optional room reference, and local-only core operation.
4. Create the real owner account during first-run setup. Use credentials approved by the owner. Do not reuse test credentials.
5. Confirm the ten tables and configure their names/sections as used in the restaurant.
6. Configure actual menu categories and products in Menu Studio and product settings. Enter owner-approved INR prices, descriptions, SKUs where used, product availability, variants/modifiers, preparation notes, and station/category routing. Do not create sample sellable items in the pilot profile.
7. Configure only the staff accounts required by the owner. The existing role and permission model is used; do not add kitchen logins.
8. Set up the Kitchen station's category routing. The workflow uses printed KOTs and the physical KOT holder. A KDS is not enabled by this profile.
9. Confirm the payment methods Cash, Card, and UPI. UPI is recorded as paid only after the payment is confirmed through the existing payment flow; displaying a QR code is not payment confirmation.
10. Leave tax calculation disabled until accountant confirmation. The tax settings page displays a pending GST registration warning. Do not select a country tax pack or enter a rate until the owner confirms registration status and the applicable configuration.

## Backup and restore boundary

The existing database backup operation checkpoints SQLite WAL and creates a self-contained database snapshot. Profile-local automatic backups are kept under that profile's `userData/FloCafe/Backups` directory. Database maintenance recovery artifacts are held in the selected profile's `userData/backups` directory.

Before pilot data is entered, make a baseline backup. After real menu/staff setup and at close of a pilot day, create a manual backup and record its path outside the Mac. Verify restore only against a separate disposable profile/database. Never test a restore against `garh-jaisal-pilot`.

A database backup preserves the database-backed catalog, settings, users, orders, bills, and configuration. Treat external files and device-specific printer queues as separate deployment assets unless the backup's actual contents prove they are embedded. The pilot's actual uploaded images/logos should be checked after setup before relying on a backup as a complete machine recovery.

## Mac acceptance run

1. Launch the development profile, add a clearly marked test product/order, close the application, then launch the pilot profile and verify the test data is absent.
2. Initialize the pilot with the Garh Jaisal preset and configure the real menu, ten tables, and Manager/Waiter accounts.
3. From the Mac, log in as Manager, open table selection, choose a configured table, add an item and modifier/instruction, submit, and verify the order appears in the kitchen/KOT flow.
4. From the phone on the same trusted Wi-Fi, log in as Waiter/Captain and confirm a table must be selected before adding items. Add an item and verify the host sees the same order. Test draft restoration and reconnect after a short Wi-Fi interruption.
5. Add more items to the active table order, generate the postpaid bill, settle with cash/card/confirmed UPI, re-open the completed bill, and verify reprint context. Verify QR display alone does not mark a payment as settled.
6. Check daily sales, payment breakdown, discount, refund, cash closing, and business-date reports with the actual configured `Asia/Kolkata` timezone.
7. Back up the pilot database. Restore that backup into a separate test profile and verify settings, menu, user configuration, orders and bill history. Do not restore over the real pilot.
8. Record the installed app version from the application/about display before accepting Windows packaging.

## Windows release handoff

Build the same tagged release from the approved commit with `npm run build:win`. The Windows installer/update workflow must keep Electron's installed `userData` directory stable across versions. The release checklist is:

- Use a versioned, signed Windows installer and retain its checksum and release notes.
- Show the installed app version in the About/settings surface.
- Before any schema migration, complete and validate a local backup in the same data profile.
- Preserve the existing SQLite database and profile settings during update/uninstall-reinstall.
- Require an owner/manager to approve an update window and close the app before installation.
- After update, verify schema version, database integrity, active menu, table/order access, and a test receipt before resuming service.
- Keep the previous installer and a tested backup available with recovery instructions. Do not downgrade a database with a newer schema; use the app's existing recovery path.

Physical acceptance for the Epson/printer estate remains deferred until the owner supplies exact model, interface, width, and Windows queue/network details.
