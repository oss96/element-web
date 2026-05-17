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

The three steps are independent — webpack, asar pack, electron-builder.
Run them in sequence:

```bash
# 1. Clean previous build outputs (skip this on Windows if you're sure the
#    last build was identical; otherwise old webpack chunks pile up and
#    push the asar from ~170 MB to ~900 MB).
rm -rf apps/web/webapp apps/desktop/webapp.asar apps/desktop/dist

# 2. Build the web bundle (~80 s).
pnpm --filter element-web build

# 3. Pack the web output into an asar archive (~10 s).
pnpm exec asar pack apps/web/webapp apps/desktop/webapp.asar

# 4. Run electron-builder, Squirrel-only.
cd apps/desktop
pnpm exec electron-builder --win squirrel
```

Outputs:

- `apps/desktop/dist/squirrel-windows/Element Setup 1.12.18.exe` — the
  one-click per-user installer (~186 MB).
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

The Squirrel installer drops Element into `%LocalAppData%\Element\` — no
admin prompt. User data (login, settings, encryption store) lives in
`%AppData%\Element\` and persists across reinstalls and version upgrades.

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
