# Building the patched Element Desktop installer

A walkthrough for producing a Windows installer of this fork from a fresh
checkout. Tested on Windows 11 with Node 22.x and pnpm 10.33.3.

## Prerequisites

- **Node ≥ 22.18** (the monorepo's `engines.node`)
- **pnpm 10.33.3** — match the `packageManager` field exactly to avoid
  workspace-protocol surprises:
  ```powershell
  npm install -g pnpm@10.33.3
  ```
- **Git** with longpaths enabled (the deeper paths under `node_modules/`
  cross Windows's 260-char limit otherwise):
  ```powershell
  git config --global core.longpaths true
  ```
- **Visual C++ build tools** if `electron-rebuild` decides to compile a
  native dep from source. Usually the prebuilt binaries it pulls down are
  enough.

## One-time setup

```bash
# from the repo root
pnpm install
```

Takes 1-2 minutes. The `postinstall` hook builds matrix-js-sdk and runs
`electron-builder install-app-deps` to fetch the right native binaries
for your Electron version.

## Build a fresh installer

The steps are independent — clean, webpack, desktop TS, asar pack,
electron-builder. Run them in sequence:

```bash
# 1. Clean previous build outputs. Always wipe these together — leaving
#    any one of them around has produced silent CHECK-aborts on launch
#    under Electron 42 (see troubleshooting below). The electron-builder
#    cache in particular holds a fuse-stamped Electron binary whose
#    embedded asar hash is from a *previous* build's asar; a partial
#    rebuild leaves the binary expecting the old hash.
rm -rf apps/web/webapp \
       apps/desktop/webapp.asar \
       apps/desktop/dist \
       apps/desktop/lib
# PowerShell: Remove-Item -Recurse -Force $env:LOCALAPPDATA\electron-builder\Cache
rm -rf "$LOCALAPPDATA/electron-builder/Cache"

# 2. Build the web bundle (~80 s).
pnpm --filter element-web build

# 3. Compile the desktop main-process TS and copy resources into apps/desktop/lib.
#    The nx `build` target depends on these via `build:*`, but invoking
#    electron-builder directly (step 5) skips that dep chain — so when lib/
#    is wiped, you have to run these explicitly or app.asar ends up missing
#    `lib/electron-main.js` and electron-builder fails the sanity check.
cd apps/desktop
pnpm exec nx build:ts element-desktop
pnpm exec nx build:res element-desktop

# 4. Pack the web output into an asar archive (~10 s).
pnpm exec asar pack ../web/webapp ./webapp.asar

# 5. Run electron-builder, Squirrel-only.
pnpm exec electron-builder --win squirrel
```

Outputs:

- `apps/desktop/dist/squirrel-windows/Element Setup 1.12.18.exe` — the
  one-click per-user installer (~180 MB).
- `apps/desktop/dist/win-unpacked/Element.exe` — if you want to run it
  without installing.

## Why `--win squirrel` and not the default `["squirrel", "msi"]`?

Upstream's `electron-builder.ts` config builds both Squirrel and MSI for
Windows. The MSI target shells out to `msiexec`, which has a habit of
leaving a `dist/__msi-x64` directory locked even after the build finishes,
producing `EBUSY: resource busy or locked, rmdir` on the next run. Squirrel
alone is enough for personal install and avoids the failure mode.

If you ever need an MSI (e.g. for `winget` or group-policy deploy), kill
any lingering `msiexec` first (`Stop-Process -Name msiexec -Force` in
PowerShell), then run without the `--win` flag.

## Installation

The Squirrel installer drops Element into `%LocalAppData%\element-desktop\`
(versioned subdirectory `app-1.12.18\`) — no admin prompt. User data
(login, settings, encryption store) lives in `%AppData%\Element\` and
persists across reinstalls and version upgrades.

## Troubleshooting

### "Could not find a declaration file for module '@element-hq/web-shared-components'"

The shared-components workspace package's `.d.ts` files weren't generated
or got stripped from the nx cache. Force a regeneration:

```bash
rm -rf packages/shared-components/dist
cd packages/shared-components
pnpm exec vite build
```

### "EBUSY: resource busy or locked" on `dist/__msi-x64`

A previous build's `msiexec.exe` is still holding the directory. Run:

```powershell
Stop-Process -Name msiexec -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\desktop\dist\__msi-x64
```

Then re-run the build (preferably with `--win squirrel` to skip MSI).

### `webapp.asar` is huge (~900 MB)

You forgot to `rm -rf apps/web/webapp` before rebuilding. Webpack writes a
fresh hash-versioned chunk directory on each invocation and never cleans
up the old ones, so old chunks accumulate. Wipe and rebuild.

### Installer succeeds but the installed Element.exe silently exits on launch

Symptoms:
- Double-clicking the Start Menu / Desktop shortcut does nothing.
- No window appears.
- `%LocalAppData%\CrashDumps\Element.exe.<pid>.dmp` files accumulate, each ~8 MB.
- The Application event log shows `Exception code: 0x80000003` (STATUS_BREAKPOINT)
  inside `Element.exe` at a fixed offset, repeatable on every launch.
- Launching `Element.exe --enable-logging=stderr` reveals the actual cause:
  `[FATAL:electron\shell\browser\net\asar\asar_file_validator.cc:129]
   Failed to validate block while ending ASAR file stream: 0`.

Diagnosis: Electron 42 enforces the `enableEmbeddedAsarIntegrityValidation`
fuse strictly. The fuse stamps a hash of `app.asar` into the executable's
resource section at build time; if the asar on disk doesn't match, Electron
hits a `CHECK()` and the process dies before any window appears. With
electron-builder 26.9.1, a partial rebuild (or a stale
`%LocalAppData%\electron-builder\Cache`) can leave the binary stamped with
a hash from a *previous* build's asar.

Fix: do a fully-clean build per step 1 above (including the
electron-builder Cache wipe). If the symptom recurs after a clean build,
flip `enableEmbeddedAsarIntegrityValidation: false` in
`apps/desktop/electron-builder.ts` — it loses one tamper-detection layer
but is harmless for a personal-fork install.

### `pnpm install` fails on Windows with "filename too long"

Enable Git long paths:
```powershell
git config --global core.longpaths true
```
Then delete `node_modules` and re-run `pnpm install`.

## Running the dev server (no installer)

For iterating on the web side without rebuilding the installer:

```bash
cd apps/web
pnpm start
```

Serves at `http://localhost:8080` (or `8081` if 8080 is taken). To point
the dev server at your homeserver, drop a `config.json` next to the dev
server output (`apps/web/config.json` — copy-webpack-plugin picks it up):

```json
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "https://your-homeserver.example.com",
      "server_name": "your-domain.example.com"
    }
  }
}
```

The dev server hot-reloads on `config.json` changes too.
