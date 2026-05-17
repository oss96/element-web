# CLAUDE.md — `oss96/element-web` fork

Project-specific context for Claude sessions working on this fork. Upstream
is `element-hq/element-web`; this fork lives at `github.com/oss96/element-web`.

The fork has two intertwined goals: **customisable keyboard shortcuts** on
the Keyboard settings tab (click-to-rebind, per-shortcut "Make global" via
Electron's `globalShortcut` API, synthetic-event dispatcher fanning OS-level
firings back into in-app handlers) and **call shortcuts + feedback** that
work across both legacy 1:1 calls and Element Call (group). The latter
includes the `ToggleIncomingAudioInCall` shortcut, mic/incoming-audio
confirmation tones, a speaking-indicator pulse, system-audio sharing in the
screenshare picker, a primary-tile mic indicator following the local feed
in 1:1, and (newly) widget-API mic toggle + host-side mic indicator for
group calls.

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
- `apps/web/test/unit-tests/accessibility/KeyboardShortcutsCustomization-test.ts`
  Unit tests for the pure helpers (currently 23 cases).

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
  invokes `releaseGlobalShortcuts()` from `beforeQuit`.
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
  per-call mute state to each `AudioFeed`.
- `apps/web/src/components/views/voip/LegacyCallView.tsx` — handles
  `ToggleIncomingAudioInCall` in `onNativeKeyDown` via
  `LegacyCallHandler.instance.toggleIncomingAudioMuted(call.callId)`.
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
- **`pnpm i18n` writes placeholder values for *new* keys.** After it
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
- **`@element-hq/web-shared-components`'s `.d.ts` files don't survive
  the nx build cache reliably.** If `lint:types` complains about missing
  declarations, force a vite rebuild:
  `rm -rf packages/shared-components/dist && cd packages/shared-components && pnpm exec vite build`.
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
  `MatrixClientPeg` before *its* module finishes evaluating, producing
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
  background. See `CallMicIndicator.tsx` for the portal + ResizeObserver
  + `timeline_resize` dispatcher pattern.
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

## Upstream sync

Default branch is `develop`, mirroring upstream.

```bash
git fetch upstream
git checkout develop
git merge upstream/develop  # or rebase — same effect, fork is fast-forward-only
git push
```

Likely conflict sites if upstream churns:
- `apps/web/src/settings/Settings.tsx` — interface entries are alphabetically grouped; new neighbours will conflict.
- `apps/web/src/i18n/strings/en_EN.json` — adjacent keyboard and voip keys.
- `apps/web/src/accessibility/KeyboardShortcutUtils.ts` — small surface, low risk.
- `apps/web/src/KeyBindingsManager.ts` — the `isKeyComboMatch` rewrite means upstream changes here will need re-applying on top.
- `apps/web/src/stores/widgets/ElementWidgetActions.ts` — `MuteRemoteAudio` enum entry; conflicts if upstream adds adjacent values.
- `apps/web/src/models/Call.ts` — `CallEvent` enum gained `AudioMuteState` and `ElementCall` gained mute state + methods around `onDeviceMute` / `onJoin`. Conflicts likely if upstream rewrites either.
- `apps/web/src/components/views/voip/CallView.tsx` — small render-tree addition for the indicator.

## Tests

```bash
cd apps/web
pnpm exec jest --testPathPatterns="(KeyBinding|Keyboard)"
```

41 tests, 5 suites. The KeyboardUserSettingsTab snapshot test passes
because `window.electron` is undefined in jsdom — the desktop-only Global
toggle is hidden in the snapshot.

## Lint pipeline

```bash
pnpm lint:types   # nx tsc across web + desktop + packages
pnpm lint:js      # eslint with --max-warnings 0
pnpm lint:style   # stylelint res/css/**/*.pcss
```

All three must be clean before `pnpm build` will produce a shippable web
bundle. `pnpm i18n` (which runs `matrix-i18n-lint` internally) must also
pass after any new `_t()` / `_td()` strings.
