# CLAUDE.md — `oss96/element-web` fork

Project-specific context for Claude sessions working on this fork. Upstream
is `element-hq/element-web`; this fork lives at `github.com/oss96/element-web`.

The fork has two intertwined goals: **customisable keyboard shortcuts** on
the Keyboard settings tab (click-to-rebind, per-shortcut "Make global" via
Electron's `globalShortcut` API, synthetic-event dispatcher fanning OS-level
firings back into in-app handlers) and **call shortcuts + feedback** that
work across both legacy 1:1 calls and Element Call (group). The latter
includes the `ToggleIncomingAudioInCall` shortcut, mic/incoming-audio
confirmation tones, a speaking-indicator pulse, audio sharing in the
screenshare picker (system loopback for screens, per-application loopback
for windows on Windows), a primary-tile mic indicator following the local
feed in 1:1, and (newly) widget-API mic toggle + host-side mic indicator
for group calls.

## Keeping these docs current

When you change anything fork-specific — new feature, behaviour change on
an existing one, new or removed file, a scope cut lifted, a default
flipped — update **both** `CLAUDE.md` and `FORK_CHANGES.md` in the same
change. Touch `BUILDING.md` too if the build / installer flow shifted.
Treat the docs as part of the diff, not follow-up work: a feature that
isn't reflected here is invisible to the next session.

- `CLAUDE.md` (this file) — agent-facing working brief: what to know to
  be useful, plus gotchas, lint pipeline, test commands, upstream sync.
- `FORK_CHANGES.md` — file-level inventory vs upstream (new files,
  modified files, new IPC channels / settings / actions, the conflict
  surface). The deeper reference; update it whenever a file's role
  changes.
- `BUILDING.md` — release-build + installer recipe.

## What this fork adds

**New files**

- `apps/web/src/accessibility/KeyboardShortcutsCustomization.ts`
  Store + capture helpers. `getUserShortcutOverrides`,
  `set/clearUserShortcutOverride`, `get/setShortcutGlobal`,
  `captureCombo`, `comboCanBeGlobal`, `toElectronAccelerator`,
  `dispatchSyntheticKeyEvent`, `findConflicts`, `combosEqual`.
- `apps/web/src/accessibility/GlobalShortcutsBridge.ts`
  Renderer half of the desktop bridge. `startGlobalShortcutsBridge()` is
  called from `init.tsx::preparePlatform`. Sends `setGlobalShortcuts`
  IPC on settings change; reacts to `globalShortcutFired` with a
  synthetic `KeyboardEvent` dispatched at `document`.
- `apps/web/src/components/views/settings/KeyboardShortcutEditor.tsx`
  Row component. Listens for keys at `document`-level capture phase
  while recording — earlier iterations used `AccessibleButton` and lost
  modifier presses to its internal `getAccessibilityAction` matcher.
- `apps/desktop/src/globalShortcuts.ts`
  Main-process half. Tracks its own registered set, unregisters before
  each new payload, silently skips combos already taken by the OS.
- `apps/desktop/src/windowAudio.ts`
  Per-application screenshare audio (Windows only).
  `resolveAudioForSource` maps screen sources to system `"loopback"` and
  window sources to an `applicationLoopback:<pid>` device-id object —
  Chromium ≥141's process-loopback input device, passed through
  Electron's undocumented raw-`{ id, name }` escape hatch in
  `setDisplayMediaRequestHandler` result parsing. HWND→PID resolution
  shells out to PowerShell with an inline P/Invoke of
  `GetWindowThreadProcessId` (no native module; ~1s once per
  share-start). PID-lookup failure degrades to video-only, never to
  system-wide audio.
- `apps/web/src/voip/ElementCallShortcuts.ts`
  Document-level keydown bridge for the active Element Call (group) call.
  Started from `init.tsx::preparePlatform` alongside the global bridge.
  Resolves the call via `CallStore.instance.connectedCalls`, calls
  `toggleMicrophoneMuted` / `toggleRemoteAudioMuted` on it, and plays
  `playMicToggleTone` / `playIncomingAudioToggleTone`. Inert when no
  Element Call is connected, so the legacy in-`LegacyCallView` handler
  still wins for 1:1.
- `apps/web/src/components/views/voip/CallMicIndicator.tsx`
  Three-pill overlay (mic, camera, incoming-audio) portaled into
  `document.body` (via `createPortal`). Tracks the `mx_CallView`
  bounding rect with ResizeObserver + window resize + `timeline_resize`
  dispatch, mirroring `PersistedElement`. Lives at `z-index: 10` so it
  stacks above the Element Call iframe (which `PersistedElement` mounts
  at body level with `z-index: 9`). Subscribes to
  `CallEvent.DeviceMuteState` (mute flags) and `CallEvent.SpeakingState`
  (mic pulse). Muted state flips a red `$alert` background;
  `data-speaking="true"` on the mic pill triggers the legacy-style
  green pulse animation (`@keyframes mx_CallMicIndicator_pulse`).
  Purely informational (`pointer-events: none`).
- `apps/web/res/css/views/voip/_CallMicIndicator.pcss`
  Styles for the indicator pills. Registered in `_components.pcss`.
- `apps/web/src/accessibility/KeyboardShortcutsCustomization.test.ts`
  Unit tests for the pure helpers (31 cases). Co-located vitest test
  (migrated from the old `test/unit-tests` jest path in the 2026-07 sync).

**Modified vs upstream**

- `apps/web/src/KeyBindingsManager.ts` — `KeyCombo` has an optional
  `numpad` flag; `isKeyComboMatch` accepts either `ev.key` or the
  un-shifted derivation from `ev.code` via `unshiftedFromCode`. A
  numpad-flagged combo only matches presses whose `ev.code` starts with
  `"Numpad"`; unflagged combos still match either physical key.
- `apps/web/src/accessibility/KeyboardShortcutUtils.ts` — `getKeyboardShortcuts()`
  merges user overrides on top of `KEYBOARD_SHORTCUTS` defaults.
- `apps/web/src/components/views/settings/tabs/user/KeyboardUserSettingsTab.tsx`
  — wires the editor in for editable rows, adds Reset-all, filters
  global eligibility to `CALLS` + `NAVIGATION` categories on desktop builds.
- `apps/web/src/components/views/settings/KeyboardShortcut.tsx` — adds
  a "Num" prefix when `combo.numpad`.
- `apps/web/src/settings/Settings.tsx` — registers `Keyboard.userShortcuts`
  (`IBaseSetting<Record<string, KeyCombo>>`) and `Keyboard.globalShortcuts`
  (`IBaseSetting<string[]>`) at `LEVELS_DEVICE_ONLY_SETTINGS`.
- `apps/desktop/src/preload.cts` — whitelists `setGlobalShortcuts` and
  `globalShortcutFired`.
- `apps/desktop/src/electron-main.ts` — imports the new module,
  invokes `releaseGlobalShortcuts()` from `beforeQuit`; the
  display-media handler also sends `windowAudioSupported`
  (`process.platform === "win32"`) in the picker-open payload.
- `apps/desktop/src/ipc.ts` — `callDisplayMediaCallback` resolves its
  audio half through `windowAudio.ts::resolveAudioForSource` (system
  loopback for screens, per-application loopback for windows on
  Windows, none otherwise).
- `apps/web/src/components/views/elements/DesktopCapturerSourcePicker.tsx`
  and `apps/web/src/vector/platform/ElectronPlatform.tsx` — thread the
  `allowWindowAudio` flag through so the "Also share audio" checkbox is
  live on the window tab on Windows desktop builds (disabled-with-byline
  elsewhere).
- `apps/web/src/accessibility/KeyboardShortcuts.ts` — adds
  `KeyBindingAction.ToggleIncomingAudioInCall` (default
  `Ctrl/Cmd+Alt+D`, CALLS category, eligible for "Make global").
  Originally `Ctrl/Cmd+Shift+D`; moved off Shift+D because that combo
  clashes with `ToggleSpacePanel` in NAVIGATION, and the in-app conflict
  matcher only looks within a single category so the clash was silent.
- `apps/web/src/LegacyCallHandler.tsx` — adds an
  `incomingAudioMutedCalls` Set with `setIncomingAudioMuted` /
  `toggleIncomingAudioMuted` / `isIncomingAudioMuted` and an
  `IncomingAudioMutedCallsChanged` event, mirroring `silencedCalls`.
- `apps/web/src/components/views/voip/AudioFeed.tsx` — accepts an
  optional `muted` prop and reflects it onto the `<audio>.muted`.
- `apps/web/src/components/views/voip/AudioFeedArrayForLegacyCall.tsx`
  — subscribes to `IncomingAudioMutedCallsChanged` and forwards the
  per-call mute state to each `AudioFeed`. Reaches the handler via
  `SDKContextClass.instance.legacyCallHandler` (upstream removed the
  `LegacyCallHandler.instance` static singleton in the 2026-07 sync).
- `apps/web/src/components/views/voip/LegacyCallView.tsx` — handles
  `ToggleIncomingAudioInCall` in `onNativeKeyDown` via
  `this.context.legacyCallHandler.toggleIncomingAudioMuted(call.callId)`
  (the class wires `static contextType = SDKContext`; upstream removed the
  `LegacyCallHandler.instance` static in the 2026-07 sync). Also owns
  screenshare-audio capture quality: `onScreenshareClick` requests the shared
  audio with `SCREENSHARE_AUDIO_CONSTRAINTS` (echoCancellation / noiseSuppression
  / autoGainControl all `false`) so the loopback track never joins the mic's
  AEC/APM — otherwise the shared audio ducks out whenever either party speaks.
  `tuneScreenshareAudioTrack()` then sets the track's `contentHint = "music"`,
  re-asserts the constraints, and best-effort bumps the Opus `maxBitrate`. The
  no-processing behaviour is runtime-only (Electron/Chromium loopback) and not
  exercised by unit tests — verify on a real desktop build with two participants.
- `apps/web/src/stores/widgets/ElementWidgetActions.ts` — adds two
  fork-defined actions: `MuteRemoteAudio = "io.element.mute_remote_audio"`
  (toWidget, payload mirrors `DeviceMute`'s `{ audio_enabled? }`) and
  `SpeakingState = "io.element.speaking_state"` (fromWidget,
  `{ speaking: boolean }` for VAD-driven indicator pulse). Both require
  upstream Element Call handlers to take effect; both ignored silently
  today, so no-op against vanilla EC.
- `apps/web/src/models/Call.ts` — adds `CallEvent.DeviceMuteState` (+
  exported `DeviceMuteState` payload `{ micMuted, videoMuted,
remoteAudioMuted }`) and `CallEvent.SpeakingState` (`boolean`). On
  `ElementCall`: `_micMuted` / `_videoMuted` / `_remoteAudioMuted` /
  `_speaking` state with getters; `setMicrophoneMuted` /
  `toggleMicrophoneMuted` and `setVideoMuted` / `toggleVideoMuted`
  (both via `DeviceMute`'s `audio_enabled` / `video_enabled` fields);
  `setRemoteAudioMuted` / `toggleRemoteAudioMuted` (via
  `MuteRemoteAudio`). `onJoin` probes both mic + video initial state via
  an empty `DeviceMute` send; `onDeviceMute` mirrors both flags from the
  request; `onSpeakingState` drives the pulse event.
- `apps/web/src/components/views/voip/CallView.tsx` — renders
  `<CallMicIndicator call={call} />` inside `mx_CallView` when the call
  is an `ElementCall`.
- `apps/web/src/vector/init.tsx` — also calls
  `startElementCallShortcuts()` from `preparePlatform`.
- `package.json` (root) — two build-tooling fixes, not features:
  (1) the `devEngines.packageManager` block is removed so pnpm writes a
  single-document `pnpm-lock.yaml` that nx can parse (see the pnpm-11/nx
  gotcha); (2) `"@typescript/old": "npm:typescript@6.0.3"` is added to
  `devDependencies` so `module-api`'s vite build can resolve the TS-6.0
  compiler (see the `@typescript/old` gotcha). The lockfile diverges ~181
  lines from upstream because of (2). Both must be re-applied after any
  upstream merge.
- `apps/desktop/project.json` — build-tooling fix: `lib/*.cjs` /
  `lib/*.d.cts` added to `build:ts` outputs so a cache-replayed build keeps
  `preload.cjs` (see the nx-cache/preload gotcha). Re-apply if upstream
  reverts it.

## Build / installer

See `BUILDING.md` at the repo root.

## Known limitations (deliberate scope cuts)

- **Element Call mic toggle: wired up via the widget API.** The new
  `ElementCallShortcuts` bridge resolves the active group call from
  `CallStore` and calls `toggleMicrophoneMuted()`, which uses
  `ElementWidgetActions.DeviceMute` — an upstream-defined bidirectional
  action Element Call already supports. Initial state is seeded by a
  no-op `DeviceMute` send in `onJoin`; in-widget mute changes flow back
  via `onDeviceMute` and update `CallEvent.DeviceMuteState`.
- **Element Call camera toggle: wired up via the widget API.** Same
  `DeviceMute` action as mic, but on the `video_enabled` field. Default
  combo is `Ctrl/Cmd+E` (`ToggleWebcamInCall`), routed through the same
  `ElementCallShortcuts` bridge. No audible cue (mirrors
  `LegacyCallView.onVidMuteClick`).
- **Element Call incoming-audio toggle: forward-compatible no-op.** The
  host posts a fork-defined `io.element.mute_remote_audio` widget action
  (payload mirrors `DeviceMute`). Vanilla Element Call ignores unknown
  actions, so the host-side `CallMicIndicator` pill flips and the
  `playIncomingAudioToggleTone` cue plays, but the remote audio keeps
  flowing until Element Call ships a matching widget-side handler. The
  action name is namespaced (`io.element.mute_remote_audio`) so we
  don't clash with whatever upstream eventually adopts.
- **Element Call speaking-pulse indicator: forward-compatible no-op.**
  The mic pill subscribes to `CallEvent.SpeakingState`, driven from
  fork-defined `io.element.speaking_state` fromWidget action. Vanilla
  Element Call doesn't emit it today, so the pulse stays dark until
  upstream adopts (or a custom Element Call build is paired with this
  fork). Mute state is unaffected and still visible.
- **No mouse-button support.** Electron's `globalShortcut` is keyboard-only.
  User declined a native hook library (`uiohook-napi`) and instead uses
  vendor mouse software to remap side buttons to a function key.
- **No tray persistence.** Closing the window quits the Element process, so
  global hotkeys stop working. User chose to keep the existing close-to-exit
  behaviour and manually minimise Element when they want global hotkeys live.
- **Default-binding conflicts aren't surfaced cross-category.** Binding
  `ToggleMicInCall` to `Ctrl+1` means `SwitchToSpaceByNumber` (NAVIGATION)
  also fires on the same press. The conflict-warning matcher only looks
  within a single category.
- **Per-application (window-source) screenshare audio is Windows-only.**
  macOS would need the bundle-id flavour of the device id plus a
  window→bundle-id lookup (CoreAudio process taps, macOS 14.4+) and is
  untestable here; Linux loopback is undefined in Electron. The window-tab
  audio checkbox therefore stays disabled off-Windows. Captured audio
  covers the window's whole _process tree_ (one Firefox window ⇒ all
  Firefox audio), and UWP windows resolve to `ApplicationFrameHost`, so
  UWP app audio is likely missed.
- **Window sources show an app icon, not a live preview (Windows).**
  Because window thumbnails crash (see the WGC gotcha), the window tab
  shows each window's 48×48 app icon instead of a live thumbnail. A few
  system windows have no icon and render blank. Screen sources keep live
  thumbnails. Non-Windows platforms keep live window thumbnails.

## Repo gotchas (these have bitten this project before)

- **`pnpm i18n` rewrites every language file's line endings.** Only
  `en_EN.json` ever has real content changes. Before committing, revert
  the others — either `git checkout --` each language file or use a
  filter (`git diff --numstat apps/web/src/i18n/strings/ | awk '$1==0 && $2==0 {print $3}'`).
- **`apps/web/res/css/_components.pcss` constantly shows as modified.**
  Same CRLF/LF flip noise. Revert before committing.
- **`_t()` extraction is literal-only.** `_t(cond ? "x" : "y")` makes
  matrix-i18n-lint drop BOTH strings. Always two separate calls:
  `cond ? _t("x") : _t("y")`.
- **`pnpm i18n` writes placeholder values for _new_ keys.** After it
  adds a key to `en_EN.json`, the value is the key string itself
  (e.g. `"global_off": "settings|keyboard|global_off"`). Manually replace
  with real English text before rebuilding.
- **`apps/web/webapp/` accumulates webpack chunks across builds.** Run
  `rm -rf apps/web/webapp` before any release build, or the resulting
  `webapp.asar` balloons (912 MB observed vs. 171 MB clean).
- **Electron 42 + electron-builder 26.9.1 silently crash-loop on launch
  when the asar integrity stamp is stale.** With
  `enableEmbeddedAsarIntegrityValidation: true` in `electron-builder.ts`,
  the executable's resource section holds a hash of `app.asar`; if it
  doesn't match the actual asar, Electron `CHECK()`s in
  `asar_file_validator.cc:129` and the process dies before any window
  appears (`Exception code: 0x80000003` in Event Viewer, no JS error
  surface). The clean-build recipe in `BUILDING.md` (which now also wipes
  `apps/desktop/lib` and `%LocalAppData%\electron-builder\Cache`)
  produces a coherent binary; a partial rebuild that reuses the cached
  Electron binary does not. `Element.exe --enable-logging=stderr` from
  the install dir is the fastest way to confirm it's this and not
  something else.
- **`pnpm exec electron-builder` skips the nx `build:*` dependency chain.**
  BUILDING.md's `pnpm exec electron-builder --win squirrel` step runs the
  packager directly and won't auto-compile `apps/desktop/src/*.ts` into
  `apps/desktop/lib/`. If you wipe `lib/` (or it's never been built),
  electron-builder fails with `Application entry file "lib\electron-main.js"
in the ... app.asar is corrupted`. Fix: run
  `pnpm exec nx build:ts element-desktop && pnpm exec nx build:res element-desktop`
  first, or invoke `nx build element-desktop` instead (but that swallows
  the `--win squirrel` flag — pass it via `pnpm --filter element-desktop build -- --win squirrel`).
- **pnpm 11 writes a two-document `pnpm-lock.yaml` that nx 22.7.4 cannot
  parse.** Upstream moved to pnpm 11.2.2 (`Update pnpm to v11`, #33573).
  Driven by the `devEngines.packageManager` block in the root `package.json`,
  pnpm 11 self-manages its own version by **prepending a
  `packageManagerDependencies` YAML document** to the lockfile (so the file
  begins `---` / `lockfileVersion: '9.0'` … `---` / `lockfileVersion: '9.0'`).
  nx 22.7.4's `nx/js/dependencies-and-lockfile` plugin parses the lockfile as
  a single document, so every nx-driven script (`nx build`,
  `pnpm -r lint:types`, `nx start`, the full `pnpm build`) dies at graph
  construction with `Failed to process project graph … expected a single
document in the stream, but found more`. **Fix applied in this fork:** the
  `devEngines.packageManager` block is removed from the root `package.json`,
  which makes pnpm write a single-document lockfile. The real dependency
  document is byte-identical to upstream's — only the self-management document
  is dropped. `managePackageManagerVersions: false` alone does **not** help
  (the document is gated by `devEngines`, not that setting). Because pnpm no
  longer enforces its own version, install via `corepack pnpm@11.2.2 install
--config.confirmModulesPurge=false`. **Re-apply this removal after any
  upstream merge that restores the block**, then regenerate the lockfile
  (`sed -i '1,199d' pnpm-lock.yaml` to drop the stale first doc, then
  `corepack pnpm@11.5.2 install`).
- **`module-api`'s vite build can't resolve `@typescript/old` under strict
  pnpm.** Since the TS-6 sync, `packages/module-api/vite.config.ts` does
  `require.resolve("@typescript/old")` (to point api-extractor at TS 6.0.3).
  `@typescript/old` is an *alias* (→`typescript@6.0.3`) that
  `@typescript/typescript6` declares as a private dep, so pnpm only materialises
  it inside typescript6's own `node_modules` — never hoisted, so `module-api`
  can't resolve it and **`module-api:build` and the whole `element-web` webpack
  build fail with `Cannot find module '@typescript/old'`**. This reproduces on
  vanilla upstream (the lockfile dep-graph is byte-identical), not fork damage.
  `public-hoist-pattern` does **not** fix it (pnpm hoists by real package name,
  not the alias). **Fix applied in this fork:** `"@typescript/old":
  "npm:typescript@6.0.3"` in root `devDependencies`, which links
  `node_modules/@typescript/old` at the root where module-api resolves it. A
  full reinstall (`rm -rf node_modules && corepack pnpm@11.5.2 install`) is
  needed after adding it — incremental installs report "Already up to date" and
  skip re-hoisting. **Re-apply after any upstream merge** if the webpack build
  regresses with this error.
- **`@element-hq/web-shared-components`'s `.d.ts` files don't survive
  the nx build cache reliably.** If `lint:types` complains about missing
  declarations, force a vite rebuild:
  `rm -rf packages/shared-components/dist && cd packages/shared-components && pnpm exec vite build`.
  (After a fresh upstream sync the dists are simply stale — once nx can parse
  the lockfile again, `pnpm --filter @element-hq/web-shared-components build`
  refreshes them and the `has no exported member …` errors clear.)
- **`nx start element-web` runs shared-components' `vite build --watch`
  in parallel with webpack-dev-server (via the `^start` dep).** If
  webpack starts before the first vite pass finishes, the resolve cache
  poisons against `dist/element-web-shared-components.css` (or .d.ts)
  and never retries — the dev server hangs forever on `wait until
bundle finished: /`. Workaround: pre-build the shared-components dist
  (`pnpm -C packages/shared-components exec vite build`) and run
  `pnpm -C apps/web exec webpack-dev-server …` directly to bypass nx's
  `^start`. Same root cause as the `.d.ts` gotcha above; different
  symptom and bypass.
- **`init.tsx` is sensitive to import-order side effects.** Adding a
  top-level import that transitively pulls in stores (e.g. `Call.ts`
  → `WidgetMessagingStore` / `WidgetLayoutStore`) shifts module
  evaluation order so eagerly-singletoned stores try to access
  `MatrixClientPeg` before _its_ module finishes evaluating, producing
  `ReferenceError: Cannot access 'MatrixClientPeg' before initialization`
  at app load. **Lazy-import heavy modules inside the function body,
  not at the top of the file.** See `apps/web/src/voip/ElementCallShortcuts.ts`
  for the pattern.
- **Element Call's widget iframe lives at `document.body`, not in
  `mx_CallView`.** `PersistedElement` renders the iframe into
  `#mx_PersistedElement_container` (appended to `<body>`) with inline
  `position: absolute; z-index: 9`, tracking the wrapper's bounding
  rect. Any host-side overlay that needs to stack above the iframe
  must portal to body and track the same way — bumping `mx_CallView`'s
  z-index above 9 hides the iframe behind `mx_CallView`'s own
  background. See `CallMicIndicator.tsx` for the portal/ResizeObserver/
  `timeline_resize`-dispatcher pattern.
- **`widgetApi.transport.send(...)` returns `undefined` in jest mocks.**
  The default `jest.fn()` setup in `Call-test.ts` doesn't return a
  Promise, so chaining `.then()` / `.catch()` directly on a send crashes
  the test worker with `Cannot read properties of undefined (reading 'then')`.
  Wrap with `Promise.resolve(...)` for robustness against both real
  Promise returns and bare-undefined stubs (see `onJoin` /
  `setRemoteAudioMuted` in `Call.ts`).
- **`AccessibleButton` has its own `onKeyDown`.** Inside the recorder we
  bypass it; if you reintroduce an `AccessibleButton` wrapper around any
  capture surface, expect Enter and Space presses to be hijacked and
  modifier keys to be lost mid-chord.
- **Window-thumbnail capture segfaults on Windows (Electron 42 /
  Chromium 148 + recent GPU drivers).** `desktopCapturer.getSources` with
  a non-zero `thumbnailSize` for `window` sources crashes the GPU/capture
  path: GDI is the primary window capturer, but Chromium hardcodes
  `allow_wgc_capturer_fallback(true)`, and the WGC fallback's
  `CreateForWindow` failure path segfaults. No feature flag disables the
  fallback; a native crash can't be caught in JS. The screenshare picker
  polls `getSources` for thumbnails, so it trips this on open. **Fix:**
  `ipc.ts::getDesktopCapturerSourcesSafe` enumerates window sources without
  thumbnails on win32 and surfaces each window's app icon as the thumbnail
  instead (screens keep real thumbnails). Screen thumbnails and name-only
  window enumeration are both stable; only window _thumbnails_ crash.
  Relatedly, the picker (`DesktopCapturerSourcePicker.tsx`) now fetches only
  the **active tab's** source type and at a 1000ms (was 500ms) interval — a
  screen capture is ~0.5s where DXGI duplication falls back, and capturing
  both types every 500ms pegged the main process into a visible hang. See
  BUILDING.md troubleshooting.
- **Declining "Also share audio" must OMIT the audio key, not pass
  `audio: undefined`.** The fork's screenshare always _requests_ audio
  (`getDisplayMedia({ audio: true })`) so the picker can offer the checkbox.
  Electron's display-media handler does `if (audio_requested &&
result_dict.Has("audio"))` — and `{ video, audio: undefined }` still makes
  `Has("audio")` true, so it tries to parse `undefined` as a device, fails,
  and rejects the **whole** capture with "Invalid capture constraints"
  (the share silently doesn't start). `ipc.ts::callDisplayMediaCallback`
  therefore builds `{ video }` and only sets `.audio` when there's a real
  device. Symptom if regressed: sharing works _with_ audio ticked but a
  no-audio share "opens the picker, then nothing happens".
- **nx cache replay of `build:ts` used to drop `lib/preload.cjs`.**
  Upstream's `apps/desktop/project.json` declared `build:ts` outputs as
  `lib/*.js` + `lib/*.d.ts`, which misses the `.cts → .cjs` preload emit.
  A cache-replayed `build:ts` therefore restored everything _except_
  `preload.cjs`; the packed app then silently fell back to the **web**
  platform (no `window.electron` → no calls, no screenshare picker, a
  "Failed to load service worker" toast). Fixed in this fork by adding
  `lib/*.cjs` / `lib/*.d.cts` to the outputs. If an upstream merge
  reverts `project.json`, re-apply — and always sanity-check
  `asar list ... | grep preload` before shipping an installer. See
  BUILDING.md troubleshooting.
- **Per-application screenshare audio rides an undocumented Electron
  escape hatch.** `windowAudio.ts` passes a raw
  `applicationLoopback:<pid>` device-id object as the display-media
  callback's audio; Electron's published `Streams["audio"]` type only allows
  `'loopback' | 'loopbackWithMute' | WebFrameMain`, but the C++ result
  parser (`shell/browser/electron_browser_context.cc`) deliberately
  accepts any raw `{ id, name }` ("escape hatch" comment, verified in
  the 42-x-y branch). **Re-verify the hatch still exists after every
  Electron major bump** — grep that file for `escape hatch` — and note
  the `as unknown as Streams["audio"]` cast will keep compiling even if
  the runtime support disappears.

## Upstream sync

Default branch is `develop`, mirroring upstream.

```bash
git fetch upstream
git checkout develop
git merge upstream/develop  # or rebase — same effect, fork is fast-forward-only
git push
```

Upstream is on **pnpm 11.5.2** (object-form `devEngines.packageManager`, no
corepack `packageManager` string). The fork never touches dependency files
*except* the three build-tooling fixes below, so a merge otherwise takes
upstream's `package.json` / `pnpm-lock.yaml` wholesale. After merging:
1. re-strip the `devEngines.packageManager` block from the root `package.json`;
2. re-add `"@typescript/old": "npm:typescript@6.0.3"` to root `devDependencies`
   (see the `@typescript/old` gotcha);
3. re-add `lib/*.cjs` / `lib/*.d.cts` to `apps/desktop/project.json` build:ts
   outputs;
then regenerate a single-document lockfile (see the pnpm-11/nx gotcha) and
`corepack pnpm@11.5.2 install --config.confirmModulesPurge=false`.

Last full sync: **2026-07-16**, merging up to upstream `7ad619e693` (630
commits from merge-base `afc4e52df4`; no code lost). See `sync-report.md` for
the full record. This was a **major toolchain sync**: Electron 42→**43.1.0**,
nx 22.7.5→**23.0.2**, pnpm 11.2.2→**11.5.2**, TypeScript moved to the **TS 6 /
`@typescript/native` split**; test runner **jest→vitest** (co-located
`src/**/*.test.{ts,tsx}`); lint/format **eslint+prettier→oxlint+oxfmt** (+`knip`).
Upstream still pins a `matrix-js-sdk#develop` snapshot whose TS-6.0 source
leaves **3 baseline `lint:types` errors, all inside the SDK**
(`MSC4108SignInWithQR.ts`) — none in fork/app code; the webpack build stays
green because it transpiles rather than type-checks.

Likely conflict sites if upstream churns:
- `package.json` (root) — the removed `devEngines.packageManager` block and the added `@typescript/old` alias; a merge that re-adds the block re-introduces the two-document lockfile (breaks nx) and dropping the alias breaks the module-api/webpack build. Both must be re-applied.
- `apps/web/src/components/views/voip/LegacyCallView.tsx` / `AudioFeedArrayForLegacyCall.tsx` — access the singleton via `SDKContext`/`SDKContextClass`, not `LegacyCallHandler.instance`; if upstream reworks the SDKContext plumbing these need re-checking.
- `apps/web/src/settings/Settings.tsx` — interface entries are alphabetically grouped; new neighbours will conflict.
- `apps/web/src/i18n/strings/en_EN.json` — adjacent keyboard and voip keys.
- `apps/web/src/accessibility/KeyboardShortcutUtils.ts` — small surface, low risk.
- `apps/web/src/KeyBindingsManager.ts` — the `isKeyComboMatch` rewrite means upstream changes here will need re-applying on top.
- `apps/web/src/stores/widgets/ElementWidgetActions.ts` — `MuteRemoteAudio` enum entry; conflicts if upstream adds adjacent values.
- `apps/web/src/models/Call.ts` — `CallEvent` enum gained `AudioMuteState` and `ElementCall` gained mute state + methods around `onDeviceMute` / `onJoin`. Conflicts likely if upstream rewrites either.
- `apps/web/src/components/views/voip/CallView.tsx` — small render-tree addition for the indicator.

## Tests

Upstream migrated from **jest to vitest** (2026-07 sync). Tests are now
co-located and collected as `src/**/*.test.{ts,tsx}` per project (`globals:
false`, so each test imports `{ describe, it, expect }` from `"vitest"`).

```bash
cd apps/web
pnpm exec vitest run src/accessibility/KeyboardShortcutsCustomization.test.ts
```

The fork's own test is `apps/web/src/accessibility/KeyboardShortcutsCustomization.test.ts`
(31 cases, pure helpers), migrated from the old jest path during the vitest
sync. Vitest **only** collects `src/**/*.test.{ts,tsx}` — a test left at the
old `test/unit-tests/*-test.ts` path is silently not run. (Upstream is
mid-migration: ~486 of its own tests are still at the old path and dormant.)

The upstream `KeyboardShortcutUtils` / `KeyboardShortcut` / `KeyboardUserSettingsTab`
tests are unmodified-upstream and still at `test/unit-tests/` (dormant upstream
too); they are not fork tests and were intentionally left for upstream to
migrate. The `KeyboardUserSettingsTab` snapshot passes because `window.electron`
is undefined in the test env — the desktop-only Global toggle is hidden.

## Lint pipeline

Upstream migrated eslint→**oxlint** and prettier→**oxfmt** (2026-07 sync).

```bash
pnpm -r --workspace-concurrency=1 lint:types   # nx tsc (TS 6) across web + desktop + packages
pnpm exec oxlint      # lint:js — replaces eslint
pnpm exec stylelint "apps/web/res/css/**/*.pcss"   # lint:style
pnpm exec oxfmt --check   # lint:fmt — replaces prettier
```

The root `lint` script chains `lint:types` + `lint:fmt` + `lint:js` +
`lint:style` + `lint:workflows` + `lint:knip`. `pnpm i18n` (runs
`matrix-i18n-lint`) must also pass after any new `_t()` / `_td()` strings.

> **`pnpm -r lint:types` reports 3 baseline errors, all inside the pinned
> `matrix-js-sdk#develop` source** (`MSC4108SignInWithQR.ts`) — none in fork or
> app code. The nx task exits non-zero purely because of them; verify with a raw
> `pnpm exec tsc --noEmit` in `apps/web` and grep out `matrix-js-sdk` to confirm
> 0 fork/app errors. The webpack build stays green (transpiles, not type-checks).
>
> **`oxfmt --check` is NOT runnable on the Windows checkout.** `core.autocrlf=true`
> gives CRLF working-tree files; oxfmt expects LF and flags *every* file
> (including untouched upstream ones). CI runs it on LF. **Never run `oxfmt`
> (fix) locally** — it would rewrite thousands of files to LF.
