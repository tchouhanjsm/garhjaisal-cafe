# Desktop releases

FloCafe desktop releases use one electron-builder pipeline and publish to GitHub Releases for
Windows (NSIS), macOS (DMG and ZIP), and Linux (AppImage, deb, rpm, Snap). AppX and Mac App Store
packages are produced by the same tag build and uploaded as GitHub release assets; they are not
consumed by `electron-updater` and are not submitted to their stores by this pipeline. Snap Store
uploads are separate from the GitHub release.

## Channels

The default install is the stable channel. There are exactly two channels, `stable` and `beta`.

|                         | Stable                                                                       | Beta                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Package version         | `X.Y.Z`                                                                      | `X.Y.Z-beta.N`                                                       |
| Updater manifest prefix | `latest`                                                                     | `beta`                                                               |
| Manifests emitted       | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` | `beta.yml`, `beta-mac.yml`, `beta-linux.yml`, `beta-linux-arm64.yml` |
| GitHub prerelease       | no                                                                           | yes                                                                  |
| GitHub Latest pointer   | eligible after promotion                                                     | never                                                                |
| Snap Store channel      | `stable`                                                                     | `edge`                                                               |

The manifest prefix is computed once in the release metadata step and passed to every
electron-builder invocation, so a build emits exactly one channel's manifest set. A beta build
cannot emit a `latest*.yml` manifest and a stable build cannot emit a `beta*.yml` manifest: the two
feeds are structurally isolated rather than separated by a runtime check.

Any other channel value is rejected at the release metadata step, which fails the workflow before
anything is built. A version stamped with an unsupported prerelease identifier, such as a local
alpha, is treated as beta and follows the beta feed.

A stable install leaves the updater channel unset and follows the stable feed. It can opt in to
beta updates through the in-app switch in **Settings > Updates**, which reads and writes
`updates.beta_channel_enabled` in the SQLite settings store through the
`updates:get-beta-channel` and `updates:set-beta-channel` IPC pair. Opting out returns an install to
the stable feed. A beta-stamped install that opts out does not downgrade immediately: it holds its
version until the next matching or newer stable release is published, then graduates without a
database schema rollback.

Unless the user turns it off, a desktop install checks for updates 5 seconds after startup. The
**Check for updates automatically** switch in **Settings > Updates** and the checkbox in the update
prompt both write `updates.auto_check_enabled` through the `updates:get-auto-check` and
`updates:set-auto-check` IPC pair. With the switch off, only a manual check from Settings or the
application menu contacts the update feed.

For a packaged Windows NSIS installation, each successful check that finds a newer stable or
opted-in beta release starts a background download automatically. The device also rechecks the feed
every six hours while automatic checks are enabled, the app is online, and no update is already
staged or downloading. The in-app badge shows download progress and then reports **Ready to install**.
AppX/MSIX builds remain Store-managed; development and unpacked builds do not self-update. macOS and
Linux retain the existing prompt-before-download behavior.

Automatic delivery does **not** force a restart or install during restaurant service. The installer
is staged until a manager or owner chooses **Restart now** and passes the main-process Master PIN
check. Automatic installation on quit remains disabled.

The main process independently verifies operational safety before it accepts the PIN and checks
again immediately after PIN approval, before shutdown begins. Installation is refused while a cash
shift is open, active orders or kitchen items remain, a held order exists, a bill is unsettled,
database backup/restore maintenance is active, or the current tenant-local business day has activity
that has not been closed. If the database or operational state cannot be read, installation fails
closed and the app remains running. The confirmation still warns that POS, KDS, printing, and
reports are unavailable while the update installs. Cancelling the prompt, failing PIN approval, or
failing the operational gate leaves the app running.

### Windows signing and deployment readiness

The Windows release workflow fails closed unless signing is configured. Set the
`WINDOWS_CERTS` and `WINDOWS_CERTS_PASSWORD` GitHub secrets to the signing bundle accepted by
electron-builder, and set the `WINDOWS_SIGNING_SUBJECT` repository variable to the exact
Authenticode certificate Subject. Before Windows assets are uploaded, the release job verifies the
actual NSIS installer and AppX package signatures and rejects an invalid signature or Subject
mismatch. The immutable candidate manifest records Windows as signed only after that verification
passes. A valid Authenticode signature does not itself prove SmartScreen reputation.

Until these values point to a real trusted certificate identity, the Windows release job is
intentionally blocked. Do not remove the signature checks or distribute an unsigned installer to
staff as a workaround. The automatic updater does not bypass Windows signature or installer checks.

The installed app keeps its SQLite database and settings in Electron's per-user data directory,
outside the NSIS application directory. Updating replaces application files; it does not replace the
restaurant profile. On the next launch, the normal migration path performs its pre-migration backup
and schema checks. Keep the normal local backup and restore process in place, and test one real
Windows upgrade against a disposable profile before upgrading the hotel's production profile.

### Windows pilot installation

Use **Actions > Windows Pilot Installer > Run workflow** from the `main` branch after the Windows
signing secret and variable above have been configured. The workflow builds only the x64 NSIS
installer, verifies its Authenticode status and exact signer Subject, checks that both desktop and
Start Menu shortcuts are enabled, and uploads the signed installer as a private Actions artifact
for 14 days. It does not create a GitHub Release, publish an update feed, build an AppX package, or
validate automatic updates. The artifact is for controlled pilot acceptance, not general staff
distribution.

The NSIS configuration creates a **Flo Cafe** desktop shortcut and a Start Menu shortcut. Verify
both on the real Windows machine; a hosted build can check the packaging configuration and
signature, but cannot prove that Windows Explorer, the desktop, firewall, or attached hardware
behaves correctly on the hotel computer.

#### Garh Jaisal Windows acceptance

1. On a clean Windows install, download the signed pilot artifact from the Actions run and verify
   the signer shown in the file's **Properties > Digital Signatures** tab.
2. Run the installer, keep the desktop shortcut option enabled, finish installation, and confirm
   that **Flo Cafe** appears on both the desktop and Start Menu. Open it using the desktop icon.
3. Before creating a new owner, use the first-run **Restore from file** action to restore the
   database backup exported from the Mac. Sign in with the restored owner account, then configure
   a fresh Windows-local Master PIN; its encrypted value belongs to Windows secure storage and is
   not carried inside the SQLite database backup.
4. Confirm the restored Garh Jaisal menu, staff, 10 tables, room-number setting, and tax settings.
   Keep the Mac staging profile separate; Windows becomes the only writable production database.
5. Connect the Epson TM-T82X to the same trusted private LAN. Reserve its address in the router,
   configure it once under **Settings > Printers**, and verify **Test Print**, a sample KOT, and a
   customer receipt. Include a receipt check for the optional room number.
6. Enable **Server App**, pair one captain phone using **Settings > Mobile Access**, and submit one
   controlled test order. Verify that the Windows hub records it and the Epson prints the KOT.
7. Complete a controlled order-to-payment-to-closing cycle, verify the cash and sales reconciliation,
   and create a fresh Windows backup. Repeat the basic launch and printer test after restarting
   Windows and the Epson.

Do not hand the machine to staff for live service until this physical acceptance passes. Hosted CI
cannot test printer paper, cutter behaviour, the hotel router, Windows firewall prompts, or the
captain's actual phone browser. Keep the POS and printer endpoints on the trusted private business
network; do not expose them directly to the public internet.

## Snap Store publication

Each Linux architecture publishes its own snap, tagged separately, and the Snap Store keeps
multiple per-architecture revisions under the one snap name.

| Release channel | Snap Store channel |
| --------------- | ------------------ |
| `stable`        | `stable`           |
| `beta`          | `edge`             |

Beta publishes to `edge` because the Snap Store credential macaroon in use is scoped to the
`stable` and `edge` channels. This keeps a prerelease out of the stable package-manager channel.

Publication evidence is asymmetric by design. A stable release requires a sanitized publication
marker for both `x64` and `arm64`; missing or invalid markers block draft verification and block
promotion. A beta release does not require the markers, because beta Snap publication is
permission-limited, and an upload denied with `invalid-channel-permission` is downgraded to a
warning rather than failing the release. The GitHub release still carries the full snap artifact
set.

The Snap Store credential check is at runtime rather than in an `if:` condition, because GitHub
Actions does not allow `secrets` in `if:` expressions. A missing credential is a release failure,
not a skipped channel.

## PostHog release builds

The release build steps and the Mac App Store lane set `FLO_OFFICIAL_RELEASE=1`, which marks the
build as an official release in `build-identity.json`. Those builds are the only source of
`production` analytics. The same steps pass the `POSTHOG_PROJECT_TOKEN` secret (or repository
variable) and the optional `POSTHOG_HOST` variable, which `scripts/copy-runtime-assets.cjs` writes
into `build-identity.json`. Without a token the release ships with PostHog inactive. A developer can
opt any run in with `FLO_POSTHOG_DEV=1`; its events are tagged `development`. See [PostHog](../architecture/cloud-integrations.md#posthog).

Each Linux, macOS, and Windows build step runs `npm run sourcemaps:posthog`
(`scripts/posthog-sourcemaps.cjs`) between the builds and `electron-builder`. When the
`POSTHOG_CLI_API_KEY` secret and the `POSTHOG_CLI_PROJECT_ID` variable are both set, the renderer
export is built with browser source maps, and the script injects chunk ids into `frontend/out` and
`dist`, uploads their maps as release `flocafe` at the `package.json` version, and deletes the
`.js.map` files so they do not ship. The upload uses `--release-mode symbol-set`, so each uploaded
symbol set is bound to that release; the default `event` mode leaves them unbound.
`POSTHOG_CLI_HOST` defaults to `https://eu.posthog.com`.
The script runs a pinned `@posthog/cli` version through `npx`, so a new CLI release cannot change the upload; update the pin on purpose.
The CLI gets only `PATH`, home and temp directories, proxy and npm cache settings, and
`POSTHOG_CLI_*`; signing certificates and store credentials in the job are not passed to it.

Without the key or the project id, the step prints a skip notice and the build is unchanged. An
upload failure is a warning, not a release failure, and the maps are deleted anyway so a failed
upload cannot ship the renderer source; a rerun rebuilds them. The key needs the `error tracking
write` and `organization read` scopes.

To check a release, open a served chunk in the packaged app and look for a `//# chunkId=` comment,
then confirm the symbol sets under Error tracking settings in PostHog.

## Artifact naming

Every published release must carry this exact inventory.
[`scripts/verify-release-assets.cjs`](../../scripts/verify-release-assets.cjs) requires all of these
names and no substitutes.

| Platform | Artifact names, where `<version>` is the release version                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `flocafe-<version>-win-x64.exe`, `flocafe-<version>-win-x64.exe.blockmap`, `flocafe-<version>-win-x64.appx`, `flocafe-<version>-win-arm64.appx`                                                                                                                                                            |
| macOS    | `flocafe-<version>-mac-x64.dmg`, `flocafe-<version>-mac-arm64.dmg`, `flocafe-<version>-mac-x64.zip`, `flocafe-<version>-mac-arm64.zip`, `flocafe-<version>-mac-x64.zip.blockmap`, `flocafe-<version>-mac-arm64.zip.blockmap`                                                                               |
| Linux    | `flocafe-<version>-linux-x64.appimage`, `flocafe-<version>-linux-arm64.appimage`, `flocafe-<version>-linux-x64.deb`, `flocafe-<version>-linux-arm64.deb`, `flocafe-<version>-linux-x64.rpm`, `flocafe-<version>-linux-arm64.rpm`, `flocafe-<version>-linux-x64.snap`, `flocafe-<version>-linux-arm64.snap` |

Plus the two uninstaller scripts `uninstall-macos.sh` and `uninstall-windows.ps1`.

The architecture token is `x64` or `arm64`. electron-builder's own target spellings
(`x86_64`, `amd64`, `aarch64`) are not used in release asset names, and a release using them fails
verification. [`scripts/assert-release-artifact-names.cjs`](../../scripts/assert-release-artifact-names.cjs) additionally requires every
filename in `release/` to match `[a-z0-9.-]+`.

Older releases, before the naming contract was enforced, used the electron-builder spellings, such
as `flocafe-3.3.0-x86_64.AppImage`. The upgrade matrix falls back to those names when fetching a
release N, but nothing produces them today.

## Promotion to GitHub Latest

Promotion is two separate jobs with deliberately different guards.

`promote-stable` runs inside the tag workflow and has a backward guard. Before moving the Latest
pointer it compares the candidate tag against the current Latest with `sort -V` and refuses to
promote if the current Latest is newer. It also refuses a draft release and refuses a prerelease.

`promote-release` is a manual dispatch for promoting an already-published historical stable
release, for example one that was held back. It has no ordering guard. That asymmetry is
intentional: the automatic path runs on a tag that CI has just built and verified, so moving
Latest backward there is always a mistake worth failing on. The manual path exists for the
recovery case where a release is promoted after a gap, and there the operator is making an
explicit, informed choice about a tag that was verified when it was built. It still refuses a
non-stable channel, a draft, and a prerelease.

Both jobs require `promote_stable=true`, which the release metadata step refuses for any channel
other than stable.

## Release evidence

Each published release carries a `release-summary.json` asset, and sanitized candidate evidence is
retained as a workflow artifact for 90 days. That release asset is the durable index. A
documentation page is not.

`release-summary.json` is built by
[`scripts/release-gate/evidence.cjs`](../../scripts/release-gate/evidence.cjs) and deliberately has a
fixed schema. It rejects credential-bearing field names and credential-shaped values rather than
trying to clean arbitrary logs after the fact, so a summary can never contain a password, PIN,
token, or private key.

Every status in the summary is one of `PASS`, `FAIL`, or `NOT-RUN`. The distinction is the point:

- **`PASS` means a check ran and the thing it checks was verified.** A Snap row reads `PASS (x64
  and arm64 publication evidence recorded)` only when both per-architecture markers exist.
- **`NOT-RUN` means nobody checked, and is not a pass.** The manual and residual-risk rows are
  always `NOT-RUN`, including `windowsSmartScreen`, `desktopCompositor`, `physicalPrinters`,
  `masReview`, and `microsoftStore`.
- **`FAIL` blocks.** A stable release with incomplete Snap publication evidence summarizes as
  `FAIL` and promotion is blocked.

Windows direct-download signing is always recorded as an explicit status. A build explicitly
marked unsigned is summarized as `UNSIGNED (accepted residual risk)`, and a build whose signing
status was never verified is summarized as `NOT-VERIFIED`. Neither is signing or SmartScreen
evidence.

The Windows installer ships unsigned, so users see the SmartScreen "Windows protected your PC"
prompt, and SmartScreen reputation is an interactive Windows behaviour that hosted runners cannot
observe.

## Manual pre-release QA

CI covers Chromium in Electron and the packaged desktop app. The standalone server app on port
`3003` is the one surface FloCafe does not control the runtime for: staff reach it from whatever
browser their device has. Before promoting a stable release, check it on:

- **Safari on iOS**, current major version.
- **An older Android WebView**, the default in-app browser on a device that has not been updated to
  the current Chrome or WebView release.

Check that the page loads and renders the store's regional currency and timezone rather than
fallback values, that order creation and the payment flow complete, and that live updates do not
silently stall. Record the device, OS, and browser you tested in the release notes or the release
pull request.

## Cutting a release

### Beta

1. Pick the version as `X.Y.Z-beta.N`, counting `N` up within the same `X.Y.Z`. Bump
   `package.json`. CI generates release notes with `git-cliff`, falling back to `CHANGELOG.md`.
2. Commit the version bump to `main`, tag exactly `X.Y.Z-beta.N`, and push the tag.
3. Run **Actions > Release > Run workflow** from that tag with `release_tag=X.Y.Z-beta.N`,
   `channel=beta`, and `promote_stable=false`.
4. The workflow builds every platform against the beta manifest prefix, verifies the draft against
   the beta manifests and their referenced artifacts, creates the immutable
   `candidate-manifest.json` and the sanitized `release-summary.json`, then publishes as a
   prerelease with `make_latest=false`.

A beta never becomes GitHub Latest, and the stable feed is unchanged by a beta publication. A
propagation check confirms that the beta artifacts are reachable and that stable Latest did not
move.

### Stable

1. Follow the same steps with an `X.Y.Z` version, `channel=stable`, and `promote_stable=false`.
2. Verify the draft, the installed-artifact upgrade matrix, and the manual server app checklist.
3. Run a second dispatch of the same workflow with `promote_stable=true` to move the verified
   release to GitHub Latest.

The candidate gate workflow consumes only a published beta, and only when given the exact
candidate manifest asset ID and SHA-256. It verifies propagation and that stable Latest is
unchanged. It does not publish or promote.

## Mac staging and remote production access

The hotel Windows machine is the authoritative production POS, SQLite database, and printer host.
The Mac does not keep a second writable production database. The owner uses the Windows-hosted
dashboard remotely; this avoids two production copies drifting apart.

For Mac development and staging, use the dedicated staging profile:

```sh
FLO_PROFILE=staging FLO_MATRIX_OFFLINE=1 npm run dev
```

This creates a local staging database, backups, logs and Electron session data below the staging
profile's Electron user-data directory, including when Electron is unpackaged. The staging profile
is created before Electron logging and SQLite initialize. `FLO_MATRIX_OFFLINE=1` keeps optional
cloud registration, telemetry and update traffic off; orders, KDS, payment and report logic remain
local. Use synthetic/test menu, staff and transactions. Never import the live restaurant database
into staging. Unprofiled `npm run dev` retains the existing project-root `flo.db` behavior.

Use the existing unprofiled packaged install data directory only for a local production install.
For this rollout, the Mac production workspace should instead open the hotel dashboard through a
private VPN connection to the Windows host's main web/API service (default local port 3001).
The dashboard is served by that host, and its API client uses the browser's current origin, so menu
writes and report reads go to the Windows SQLite database. Use a separate owner login and the
existing backend permissions. Do not expose port 3001 directly to the public internet.

For Tailscale, keep the web service private to the tailnet and reverse-proxy the Windows loopback
service using Tailscale Serve with HTTPS. Do not use Funnel. Keep KDS (3002) and the waiter Server
App (3003) on the hotel LAN; do not publish those endpoints to the internet or tailnet unless an
explicit operational need and separate access rule are approved. Windows Firewall should continue
to limit LAN services to the hotel private network.

The local API, KDS and Server App use ports 3001/3002/3003 by default. The Electron app retains its
normal single-instance behavior; profile names isolate data, not concurrently running desktop
processes. Stop the local staging app before launching another local Electron instance.

The updater's GitHub owner/repository must match the repository that receives the release assets.
This fork publishes its release assets to `tchouhanjsm/garhjaisal-cafe`, and the electron-builder
configuration embeds that same repository in installed update metadata. One signed/versioned tag
builds Windows NSIS and macOS DMG/ZIP artifacts from the same source commit. Direct-download
installations can discover the same stable release; Windows NSIS and macOS direct-download are
the relevant in-app updater products (Store builds are store-managed).

## Tag and branch lifecycle

Beta-prep branches are temporary working branches. Release tags and GitHub Releases are the
authoritative history: commit the version bump to `main`, create an annotated signed tag from that
`main` history, and push the exact `X.Y.Z-beta.N` or `X.Y.Z` tag.

Repository administrators must additionally protect numeric release tags from arbitrary creation,
deletion, and force-updates, and require signed commits and signed tags for the release actors. The
workflow's own gate is the repository-code control. The GitHub rules are the platform-level control
that stops an unauthorized tag push from reaching the workflow at all.
