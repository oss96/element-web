# Upstream sync report

## 2026-07-16 — sync develop to upstream `7ad619e693`

**Range merged:** merge-base `afc4e52df4` → upstream/develop `7ad619e693`
(`Update dependency postcss to v8.5.19`, #34312). 630 upstream commits, ~6
weeks. Pre-merge develop tip: `08d3b0b394` (abort target).

**Branch strategy:** merged `upstream/develop` into `develop` (the fork's
integration branch — it carries 23 fork commits, it is *not* a clean upstream
mirror). Feature branch `feat/screenshare-audio-by-application` merged from
`develop` afterwards. The pending screenshare-audio quality tuning was
committed to the feature branch first (`00b9fc3ad3`) so the merge ran on a
clean tree.

### Major upstream changes landing in this sync

- **Toolchain overhaul.** Electron 42.3.0 → **43.1.0**; nx 22.7.5 → **23.0.2**;
  pnpm 11.2.2 → **11.5.2**; TypeScript moved to the **TS 6 / `@typescript/native`
  + `@typescript/typescript6`** split (root `typescript` is now `catalog:ts6`).
- **Test runner: jest → vitest.** Collection is now per-project
  `src/**/*.test.{ts,tsx}` (co-located, `.test.` naming). Upstream is
  mid-migration: ~184 tests already co-located in `src/`, **~486 still at the
  old `test/unit-tests/*-test.ts` path and currently dormant** (not collected
  until moved). A `jest-mock-vitest-adapter` shim exists at
  `apps/web/test/setup/adapter.ts`.
- **Lint/format: eslint + prettier → oxlint + oxfmt** (plus `knip`,
  `lint:workflows`). `.eslintrc.cjs` / `.prettierrc.cjs` deleted;
  `.oxfmtrc.jsonc` added. Root `lint` = `lint:types` + `lint:fmt` (oxfmt) +
  `lint:js` (oxlint) + `lint:style` + `lint:workflows` + `lint:knip`.

### Conflicts (8) and how each was resolved

| File | Resolution |
| --- | --- |
| `package.json` | Kept fork's `devEngines.packageManager` removal; **kept** upstream's new `"nx": {}`. Added `@typescript/old` alias (see fixups). |
| `pnpm-lock.yaml` | Took upstream's document wholesale, stripped the pnpm self-management first doc (`sed 1,199d`) to keep a single-document lockfile nx can parse. |
| `apps/desktop/src/electron-main.ts` | Kept fork's `audio` passthrough in the Wayland `callback`; kept upstream's oxlint-disable comment. (`audio` is `undefined` on Linux anyway.) |
| `apps/desktop/src/ipc.ts` | Kept the fork's system-loopback `callDisplayMediaCallback` audio; dropped the `await` per upstream (callback is now synchronous — oxlint `await-thenable`). |
| `apps/web/src/components/views/voip/CallView.tsx` | Merged upstream's `SDKContext` refactor with the fork's `ElementCall`/`CallMicIndicator`/`callViewRef`; dropped the now-dead `MatrixClientContext`/`cli`. |
| `apps/web/src/components/views/voip/LegacyCallView.tsx` | Kept both the fork's `CallMuteTones` import and upstream's `SDKContext` import. |
| `apps/web/src/settings/Settings.tsx` | Kept both the fork's `KeyCombo` import and upstream's `VideoRoomsBetaImage` import. |
| `apps/web/src/vector/platform/ElectronPlatform.test.ts` | File renamed by upstream (`test/unit-tests → src`, jest → vitest). Kept fork's `{ source, shareAudio: true }` picker-result shape, adopted vitest's `vi.mocked`. |

### Semantic fixes with no git conflict (would have silently broken the fork)

- **`SDKContextClass.instance.legacyCallHandler` refactor.** Upstream removed
  the `LegacyCallHandler.instance` static singleton. Two fork files still used
  it (would have failed `lint:types` only, not the merge):
  - `AudioFeedArrayForLegacyCall.tsx` — switched 4 call sites to
    `SDKContextClass.instance.legacyCallHandler`, import swapped from the
    default `LegacyCallHandler` to `{ LegacyCallHandlerEvent }` + `SDKContextClass`.
  - `LegacyCallView.tsx:312` — switched `ToggleIncomingAudioInCall` handling to
    `this.context.legacyCallHandler.toggleIncomingAudioMuted(...)` (the class
    already wires `static contextType = SDKContext`).
- **`apps/desktop/project.json`** build:ts outputs reverted to upstream
  (missing `lib/*.cjs` / `lib/*.d.cts` → drops `preload.cjs`). Re-applied.
- **oxlint fork findings (2), both fixed:** `ipc.ts` `await-thenable` (above);
  `KeyboardShortcutEditor.tsx:116` jsx-a11y `click-events-have-key-events` on
  the recording status div → `oxlint-disable-next-line` with justification
  (keys during recording are captured at document level; a local handler would
  swallow the very combo being recorded).

### New mandatory fixup this sync: `@typescript/old` resolution

Upstream's `packages/module-api/vite.config.ts` does
`require.resolve("@typescript/old")` to point api-extractor at TS 6.0.3.
`@typescript/old` is an **alias** (→ `typescript@6.0.3`) that pnpm only
materialises inside `@typescript/typescript6`'s private deps — it is not
hoisted, so it is unresolvable from `module-api`, and both `module-api:build`
and therefore the whole `element-web` webpack build fail with
`Cannot find module '@typescript/old'`. This reproduces on vanilla upstream in
a strict pnpm install (the merged lockfile body is byte-identical to
upstream's) — it is not fork merge damage. `public-hoist-pattern` does not fix
it (pnpm hoists by real package name, never the alias name).

**Fix applied:** declared `"@typescript/old": "npm:typescript@6.0.3"` as a root
`devDependencies` entry (same `typescript@6.0.3` typescript6 already depends
on), which links `node_modules/@typescript/old` at the root where module-api
can resolve it. This is a fork build-tooling fix in the same spirit as the
`devEngines` removal and the `project.json` outputs — re-apply after any
upstream merge if the module-api build regresses. Lockfile divergence from
upstream: ~181 lines (the new dep + peer recalcs), single-document preserved.

### Verify ladder results

| Gate | Result |
| --- | --- |
| Webpack build (`pnpm --filter element-web build`) | ✅ green (the real ship gate) |
| `lint:types` (all workspaces) | ✅ 0 errors in fork/app code; only 3 baseline errors inside `matrix-js-sdk` (`MSC4108SignInWithQR.ts`) — upstream SDK-pin, not a fork regression |
| `oxlint` (lint:js) | ✅ clean |
| `stylelint` (lint:style) | ✅ clean |
| `oxfmt` (lint:fmt) | ⚠️ NOT verifiable in this Windows checkout — `core.autocrlf=true` gives CRLF working-tree files and oxfmt flags all 3853 (incl. untouched upstream files). CI runs on LF. |
| vitest (fork test) | ✅ migrated `KeyboardShortcutsCustomization.test.ts` to `src/`, 31 tests pass |
| Feature-survival greps | ✅ all fork symbols present |
| Electron 43 `applicationLoopback` escape hatch | ✅ still present in `electron_browser_context.cc` @ v43.1.0 (per-app screenshare audio safe) |

### Fork test migration

Only **one** of the fork's four `test/unit-tests` files is fork-original:
`KeyboardShortcutsCustomization-test.ts` (Copyright Oss Al-Alali) — migrated to
`src/accessibility/KeyboardShortcutsCustomization.test.ts`, converted to vitest
(`import { describe, it, expect } from "vitest"` + relative imports), 31 tests
green. The other three (`KeyboardShortcutUtils-test.ts`,
`KeyboardShortcut-test.tsx`, `KeyboardUserSettingsTab-test.tsx`) are **byte-
identical to upstream** — they are among upstream's 486 dormant mid-migration
tests, not fork tests, and were left in place (upstream will migrate them;
moving them ahead would only create future conflicts).

### Follow-ups / risks

- `oxfmt` / `lint:fmt` cannot be validated locally on Windows (CRLF). Confirm in
  CI (LF). Do **not** run `oxfmt` (fix) locally — it would rewrite ~3853 files
  to LF.
- The 3 SDK baseline `lint:types` errors persist until upstream realigns its
  `matrix-js-sdk#develop` pin.
- Feature branch merge (`develop` → `feat/screenshare-audio-by-application`)
  still to be done; expect a `LegacyCallView.tsx` conflict against the
  screenshare-audio tuning commit.

## 2026-09-07 — sync develop to upstream `9a536a3419`

**Range merged:** merge-base `7ad619e693` → upstream/develop `9a536a3419`
(`Fix module composer upload options appearing twice`, #34920). 374 upstream
commits, ~8 weeks. Pre-merge develop tip: `a24d2156e0` (abort target).

**Branch strategy:** merged `upstream/develop` into `develop` first, then
`develop` into `feat/screenshare-audio-by-application`. The feature branch's
dirty tree (a BUILDING.md nx-daemon EPERM troubleshooting note plus CRLF noise)
was stashed before the merge and restored afterwards.

### Major upstream changes landing in this sync

- **Electron 43.1.0 → 44.0.0** (major). `applicationLoopback` escape hatch
  re-verified: `shell/browser/electron_browser_context.cc` on the `44-x-y`
  branch still carries the `"escape hatch"` raw `{ id, name }` audio parser, so
  `windowAudio.ts` per-application screenshare audio keeps working.
- **pnpm 11.5.2 → 11.23.0**, **nx 23.0.2 → 23.1.2** (now via `catalog:`),
  **TypeScript catalog → 7.0.2** (`@typescript/native`), `ts6` catalog stays at
  6.0.x. `@typescript/old` is still `require.resolve`d by
  `packages/module-api/vite.config.ts`, so the fork's root alias is still needed.
- **oxlint gained `typescript/no-floating-promises`** and the restriction
  ruleset; upstream prefixed hundreds of calls with `void`. `lint:js` is now
  `nx run-many -t lint:prepare -p && oxlint`.
- **Jest → vitest migration finished for the fork's surface.** The four
  upstream tests the fork had edited under `test/unit-tests/` were moved to
  co-located `src/**/*.test.tsx` and converted to `vi.*`. Git rename-detection
  carried the fork's edits across.
- **Pickle-key hardening in `apps/desktop/src/ipc.ts`** (element-web#32521 /
  #32715): `createPickleKey` now refuses to overwrite an existing but currently
  undecryptable key, and `getPickleKey` returns `null` on decrypt failure
  instead of destroying the secret. This targets the "session and encryption
  lost after a Windows reboot" failure the fork has been watching.
- `getDisplayMediaCallback` / `setDisplayMediaCallback` replaced by
  `consumeDisplayMediaCallback`; `desktopCapturer.getSources` wrapped in
  try/catch upstream.
- `$spacing-*` PostCSS variables removed; Compound `var(--cpd-space-*)` tokens
  everywhere.
- `feature_custom_themes` lab removed; `Notifications.activityIsUnread`,
  `RoomList.showPeopleSection`, `RoomList.SectionExpansionState`,
  `composerUrlPreviewCollapsed` settings added (no clash with `Keyboard.*`).

### Conflicts (10) and how each was resolved

| File | Cause | Resolution |
| --- | --- | --- |
| `package.json` | upstream bumped the `devEngines.packageManager` block the fork removes | kept it stripped (fork side); `@typescript/old` alias survived untouched |
| `pnpm-lock.yaml` | both sides rewrote | took upstream's file, dropped the 199-line `packageManagerDependencies` first document, `corepack pnpm@11.23.0 install` re-added the `@typescript/old` importer entry (+3 lines) |
| `apps/desktop/src/ipc.ts` | upstream switched to `consumeDisplayMediaCallback()` | `consumeDisplayMediaCallback()?.({ video: args[0], audio: args[1] ? "loopback" : undefined })` |
| `apps/web/res/css/views/settings/tabs/user/_KeyboardUserSettingsTab.pcss` | upstream replaced `$spacing-8` with `var(--cpd-space-2x)` | kept fork's `flex-wrap` / `row-gap`, moved all three fork `$spacing-*` uses to `--cpd-space-*` tokens |
| `apps/web/src/accessibility/KeyboardShortcutUtils.ts` | upstream dropped the `as KeyBindingAction` casts and switched to `getSettingDisabled()` | fork's user-override merge re-applied on the cast-free `key` |
| `apps/web/src/components/views/voip/AudioFeedArrayForLegacyCall.tsx` | upstream changed the React key to `deviceId + userId` | upstream key + fork `muted` prop |
| `apps/web/src/components/views/voip/LegacyCallView.tsx` (3 hunks) | upstream collapsed the `<VideoFeed>` JSX to one-liners with `primaryFeed!` | upstream's non-null assertion, fork's `micFeed={primaryMicFeed}` re-added |
| `apps/web/src/components/views/voip/VideoFeed.tsx` (2 hunks) | upstream `void`-prefixed `playMedia()` | fork's `updateMicSource` lifecycle kept (mount-time `playMedia()` stays removed — `updateFeed` already plays), `void` added |
| `apps/web/src/components/views/voip/LegacyCallView.test.tsx` | rename + `jest`→`vi` | fork's `isSpeaking` mock re-added to **all three** feed mocks (one sat outside the conflict hunk and only failed at runtime) |
| `apps/web/src/components/views/voip/VideoFeed.test.tsx` | rename + `jest`→`vi` | fork's `isSpeaking` mock re-added |

### Semantic fixes with no git conflict (would have silently broken the fork)

- `apps/web/src/components/views/elements/DesktopCapturerSourcePicker.test.tsx`
  auto-merged through the rename but kept two `jest.fn()` calls inside the
  fork-added tests → `vi.fn()`.
- **knip** (`lint:knip`) failed on three fork items: unused export
  `isShortcutGlobal` (deleted — nothing called it), duplicate
  named + default export in `CallMicIndicator.tsx` (default removed; `CallView`
  imports the named one), and `@typescript/old` listed in `knip.ts`
  `ignoreDependencies` while being a real root devDependency in the fork
  (entry removed — `knip.ts` is now a fork-modified file).
- `pnpm i18n` re-sorted `numpad_prefix` in `en_EN.json`; no new or missing keys.
- `apps/desktop/project.json` `lib/*.cjs` / `lib/*.d.cts` outputs survived
  with no conflict (verified by grep).

### Verify ladder results

| Gate | Result |
| --- | --- |
| Webpack build (`pnpm --filter element-web build`) | ✅ green, 1m47s |
| `tsc --noEmit` apps/web (all three tsconfigs) | ✅ 0 fork/app errors; **7** baseline errors inside `matrix-js-sdk` (`embedded.ts` ×4, `MSC4108SignInWithQR.ts` ×3) — SDK pin, not a fork regression. `nx lint:types` exits non-zero only because of them |
| `tsc --noEmit` apps/desktop | ✅ clean |
| `oxlint` | ✅ clean (incl. new `no-floating-promises`) |
| `stylelint` (`pnpm -C apps/web lint:style`) | ✅ clean |
| `lint:knip` | ✅ clean after the three fixes above |
| `pnpm i18n` | ✅ clean |
| `oxfmt --check` | ⚠️ not verifiable on the CRLF Windows checkout (unchanged) |
| vitest (10 fork-touched files) | ✅ 169 tests pass: `KeyboardShortcutsCustomization` (31), `KeyBindingsManager`, `KeyboardShortcutUtils`, `KeyboardUserSettingsTab`, `KeyboardShortcut`, `DesktopCapturerSourcePicker`, `LegacyCallView`, `VideoFeed`, `ElectronPlatform`, `Call` |
| Feature-survival greps | ✅ all fork symbols present (`getUserShortcutOverrides`, `startGlobalShortcutsBridge`, `startElementCallShortcuts`, `CallMicIndicator`, `ToggleIncomingAudioInCall`, `MuteRemoteAudio`, `DeviceMuteState`, `SpeakingState`, `unshiftedFromCode`, IPC channels, i18n keys) |
| Electron 44 `applicationLoopback` escape hatch | ✅ present on `44-x-y` |

### Follow-ups / risks

- **Runtime check on a packaged Electron 44 build still owed**: per-app
  screenshare audio, the WGC window-thumbnail crash workaround
  (`getDesktopCapturerSourcesSafe` — Chromium bumped, behaviour may differ),
  the asar integrity stamp, and whether upstream's pickle-key hardening ends
  the post-reboot session loss.
- The 7 SDK baseline `lint:types` errors persist until upstream realigns its
  `matrix-js-sdk#develop` pin.
- `oxfmt` still unverifiable locally (CRLF); rely on CI.
