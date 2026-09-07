# FORK_CHANGES.md — `oss96/element-web` vs upstream

A file-level inventory of everything this fork adds on top of
`element-hq/element-web@develop`. Companion to `CLAUDE.md` (which is the
working brief for Claude sessions) and `BUILDING.md` (release / installer
steps). Generated against merge-base `8e22bc6e0e` on the `develop` branch.

The fork has three interlocking goals:

1. **Make every editable keyboard shortcut user-customisable** — including a
   per-shortcut "Make global" toggle that promotes the binding to an OS-level
   hotkey via Electron's `globalShortcut` API.
2. **Improve in-call feedback for legacy 1:1 calls** — a remote-audio mute
   shortcut, audible confirmation tones on mute toggles, a speaking-indicator
   pulse on the mic icon, system-audio sharing in the screenshare picker, and
   a small UX fix that shows the local user's own mic state on the primary
   tile in a 1:1.
3. **Extend the call shortcuts and feedback into the group call (Element
   Call) surface** — the mic toggle now talks to the Element Call widget via
   `io.element.device_mute`, the incoming-audio toggle ships a host-side
   widget action (forward-compatible — see _Known limitations_), and a small
   pill in the top-left of the in-room call view mirrors mic / incoming-audio
   mute state so users can see at a glance what the host page knows.

---

## Feature inventory

### 1. Customisable keyboard shortcuts

Click any editable row on `Settings → Keyboard` to rebind it. The chip turns
into a recorder ("Press a key combination…") that captures at `document`
capture-phase to dodge `AccessibleButton`'s built-in key handling. Recording
shows the captured combo immediately, with:

- **Conflict warning** for other actions in the same category bound to the
  same combo.
- **`✕` Clear** button → stores a sentinel empty-key combo so the matcher
  refuses to fire. Distinct from reset.
- **`↺` Reset-to-default** button → drops the override, falling back to the
  factory combo.
- **Reset all** row at the top of the tab.

Persisted at `LEVELS_DEVICE_ONLY_SETTINGS` so customisations live on the
device, not the account.

### 2. OS-level global hotkeys (desktop only)

Per editable shortcut, a "Make global" toggle (only shown on Electron builds
and only for CALLS + NAVIGATION categories) registers the combo via the main
process's `globalShortcut.register`. Pressing the combo while Element is in
the background fires an IPC back to the renderer, which dispatches a
synthetic `KeyboardEvent` at `document` so the in-app handler (e.g.
`LegacyCallView`'s mic toggle) reacts as if the user had pressed it inside
Element.

Combos that aren't safely globaliseable (no non-Shift modifier and not an
F13–F24 key) get the Make-global control disabled. F13–F24 are whitelisted
because they rarely conflict with system hotkeys — handy for users who remap
mouse-side-buttons to F-keys with vendor software (see _Known limitations_).

### 3. Numpad-aware bindings

`KeyBindingsManager` learnt a `numpad` boolean on `KeyCombo`. When set, the
combo only matches presses whose `ev.code` starts with `"Numpad"`; without
the flag, a combo on `"7"` still matches both physical keys. The recorder
sets `numpad: true` when the captured `ev.code` was a Numpad code, and the
chip renders a "Num" prefix in the UI. The Electron registrar emits the
`num*` accelerator aliases (`num7`, `numadd`, `numdec`, …) so global numpad
bindings really do bind to the keypad.

The key matcher was also rewritten to compare against the un-shifted
character derived from `ev.code` via `unshiftedFromCode`, so Shift+1 records
and matches as `"1"` rather than `"!"`.

### 4. Toggle incoming-audio mute (new shortcut)

A new `KeyBindingAction.ToggleIncomingAudioInCall` mutes the remote leg of
a legacy 1:1 call without dropping the call.

- **Default**: `Ctrl/Cmd+Alt+D`. Was originally `Ctrl/Cmd+Shift+D`, moved off
  because Shift+D collided with `ToggleSpacePanel` in NAVIGATION; the
  in-app conflict matcher only looks within a single category, so the
  cross-category clash never surfaced.
- **Category**: CALLS — eligible for "Make global".
- **State**: lives on `LegacyCallHandler` as `incomingAudioMutedCalls: Set<callId>`,
  mirroring the existing `silencedCalls` Set. Public API:
  `setIncomingAudioMuted`, `toggleIncomingAudioMuted`, `isIncomingAudioMuted`,
  plus a new `IncomingAudioMutedCallsChanged` event.
- **Wiring**: `AudioFeedArrayForLegacyCall` subscribes and forwards the
  per-call mute state to each `AudioFeed`, which now accepts a `muted` prop
  and reflects it onto `<audio>.muted`. `LegacyCallView.onNativeKeyDown`
  toggles the state and shows the call controls for visual confirmation.

### 5. Audio confirmation tones on mute toggles

`apps/web/src/audio/CallMuteTones.ts` synthesises ~180 ms sine blips through
the Web Audio API (no asset shipping) when the user toggles either mic mute
or incoming-audio mute. Distinct pitches for "going live" vs "muted", and
distinct frequency pairs for mic vs incoming-audio so quick consecutive
toggles stay aurally distinct:

| Action                | Muted → | Unmuted → |
| --------------------- | ------- | --------- |
| Mic toggle            | 440 Hz  | 880 Hz    |
| Incoming-audio toggle | 330 Hz  | 660 Hz    |

Fired from `LegacyCallView.onMicMuteClick` (only when the SDK actually
flipped) and from the `ToggleIncomingAudioInCall` handler.

### 6. Speaking indicator on the in-feed mic icon

The mic-icon overlay on each `VideoFeed` tile now pulses green while the
backing `CallFeed` reports `isSpeaking() === true && !audioMuted`. Driven by
subscribing to `CallFeedEvent.Speaking` and `CallFeedEvent.MuteStateChanged`,
gated by a `data-speaking` attribute and a CSS keyframe pulse
(`mx_VideoFeed_mic_pulse`).

### 7. Primary tile mic indicator follows the local feed (1:1 calls)

In a 1:1 legacy call the primary tile shows the remote person and the
secondary tile shows the local user. By default the primary tile's mic icon
would render the _remote_ user's mic state — i.e. the user can't see whether
_their own_ mic is hot. Two changes fix this:

- `VideoFeed` accepts a new `micFeed?: CallFeed` prop. When set, the mic
  icon's mute and speaking state come from `micFeed` instead of `feed`; the
  `<video>` element still plays `feed`.
- `VideoFeed` accepts a `hideMicIcon?: boolean` to suppress the overlay
  entirely (and skip listener/volume-measurement setup).
- `LegacyCallView` detects the 1:1 local-swap case (secondary is local
  usermedia and there are no sidebar feeds) and passes the local feed as
  `micFeed` on the primary tile while setting `hideMicIcon` on the secondary.

The mic-source listener wiring was split out of the existing `updateFeed`
into a new `updateMicSource` so attach/detach is correct when only the mic
source changes.

### 8. System-audio sharing in the legacy screenshare picker

`LegacyCallView.onScreenshareClick` now requests audio from `getDisplayMedia`
with the mic-style processing **disabled** — it passes
`setScreensharingEnabled(true, { audio: SCREENSHARE_AUDIO_CONSTRAINTS })` where
`SCREENSHARE_AUDIO_CONSTRAINTS = { echoCancellation: false, noiseSuppression:
false, autoGainControl: false }` (the SDK types `audio` as `boolean` but forwards
it verbatim to `getDisplayMedia`, so a constraints object is honoured at
runtime; cast through `as unknown as boolean`). This is essential: with the
defaults on, Chromium routes the loopback track through the **same audio-
processing module as the microphone**, whose AEC reference is the call playout,
so the shared audio **ducks out whenever either party speaks** (and NS/AGC
mangle media quality). Right after enabling, `tuneScreenshareAudioTrack()` sets
the captured track's `contentHint = "music"` (full-band Opus, no DTX),
re-asserts the no-processing constraints via `applyConstraints` (belt-and-
braces), and best-effort raises the sender's Opus `maxBitrate` to 256 kbps
(reaching the private `peerConn` defensively; never throws). Desktop builds open
the custom `DesktopCapturerSourcePicker` which exposes an "Also share audio"
checkbox. For whole-screen sources the main-process display-media handler
returns `audio: "loopback"` (system-wide WASAPI loopback) on Windows/macOS
(skipped on Linux where Electron's behaviour is undefined).

> History: originally `{ audio: true }`; briefly reverted to video-only
> (`setScreensharingEnabled(true)`) as a diagnostic for a "screenshare can't be
> stopped" bug, then restored here with the no-processing constraints. The
> stop-behaviour with a two-track (video + loopback audio) stream still needs
> real-build verification — see `progress.md`.

Because audio is always _requested_ (so the checkbox can be offered), the
main-process handler must **omit** the `audio` key entirely when the user
declines — passing `audio: undefined` makes Electron's `result_dict.Has("audio")`
true and then rejects the whole capture with "Invalid capture constraints"
(`callDisplayMediaCallback` in `ipc.ts`; see the CLAUDE.md gotcha).

**Per-application audio for window sources (Windows only).** When the picked
source is an Application window on Windows, the handler instead returns
`audio: { id: "applicationLoopback:<pid>", name: "Application Audio" }` —
Chromium ≥141's process-loopback input device
(`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, captures the window's whole
process tree), smuggled through the intentional-but-undocumented raw
`{ id, name }` escape hatch in Electron's `setDisplayMediaRequestHandler`
result parsing (`electron_browser_context.cc`). The window's HWND (from the
`window:<hwnd>:<n>` source id) is resolved to its owning PID by
`apps/desktop/src/windowAudio.ts` via a one-shot PowerShell P/Invoke of
`GetWindowThreadProcessId` — no native module. If the lookup fails the share
proceeds without audio (never silently widens to full system audio). On
non-Windows platforms the checkbox stays disabled-with-byline on the window
tab, gated by a `windowAudioSupported` flag the main process sends in the
`openDesktopCapturerSourcePicker` payload.

Known per-application caveats: audio follows the _process tree_ (sharing one
Firefox window shares all Firefox audio); UWP windows resolve to
`ApplicationFrameHost`, so their actual app audio is likely missed.

Browser builds fall back to the platform-native picker's own "Share tab
audio" option.

### 9. Group call (Element Call) mic / incoming-audio shortcuts + indicator

The mic and incoming-audio shortcuts now reach into the Element Call widget,
so global hotkeys and in-app presses both work whether the active call is a
legacy 1:1 or an Element Call group session.

- **Routing**: `apps/web/src/voip/ElementCallShortcuts.ts` installs a
  `document`-level keydown listener that resolves the active group call via
  `CallStore.instance.connectedCalls`. On `ToggleMicInCall` /
  `ToggleIncomingAudioInCall` it calls the new toggle methods on `ElementCall`
  and plays the existing `playMicToggleTone` / `playIncomingAudioToggleTone`
  cues. When no `ElementCall` is connected the listener does nothing, so the
  pre-existing `LegacyCallView.onNativeKeyDown` handler still wins for 1:1
  calls. The bridge is started from `init.tsx::preparePlatform` alongside
  `startGlobalShortcutsBridge()`.
- **Widget channel — mic**: `ElementWidgetActions.DeviceMute` is bidirectional
  (`audio_enabled?: boolean, video_enabled?: boolean`). `ElementCall.start`
  was already subscribed; the handler now reads `audio_enabled` from the
  fromWidget direction to mirror the user's in-widget mute on the host, and
  the new `setMicrophoneMuted` / `toggleMicrophoneMuted` send the toWidget
  direction. On `onJoin` an empty `DeviceMute` is sent to probe the widget's
  starting state and seed the host indicator.
- **Widget channel — camera**: same `DeviceMute` action, applied to the
  `video_enabled` field. `ToggleWebcamInCall` is routed through the same
  bridge with no audible cue (mirrors `LegacyCallView.onVidMuteClick`).
- **Widget channel — incoming audio**: new fork-defined action
  `ElementWidgetActions.MuteRemoteAudio = "io.element.mute_remote_audio"`,
  payload mirrors `DeviceMute`. Vanilla Element Call ignores unknown
  actions, so the host-side shortcut updates the local pill and plays the
  cue but doesn't currently change the remote audio output — see _Known
  limitations_ for the upstream-handler requirement.
- **Widget channel — speaking pulse**: new fork-defined fromWidget action
  `ElementWidgetActions.SpeakingState = "io.element.speaking_state"`,
  payload `{ speaking: boolean }`. Drives the green pulse on the mic pill
  via `CallEvent.SpeakingState`. Vanilla Element Call doesn't emit it
  today; same forward-compatible no-op story as `MuteRemoteAudio`.
- **State on `ElementCall`**: `micMuted`, `videoMuted`, `remoteAudioMuted`,
  and `speaking` getters. Two events: `CallEvent.DeviceMuteState` carrying
  `{ micMuted, videoMuted, remoteAudioMuted }` and `CallEvent.SpeakingState`
  carrying a boolean. `setMicrophoneMuted(muted)` / `setVideoMuted(muted)`
  return the resulting state (driven by the widget's reply);
  `toggleMicrophoneMuted()` / `toggleVideoMuted()` flip and return;
  `setRemoteAudioMuted(muted)` updates state immediately and best-effort
  sends the action.
- **Indicator**: `apps/web/src/components/views/voip/CallMicIndicator.tsx`
  is portaled into `document.body` and position-fixed-tracks the
  `mx_CallView` bounding rect (mirroring `PersistedElement`'s technique),
  sitting at `z-index: 10` to draw over the Element Call iframe
  (`z-index: 9`). Three 24×24 circular pills (mic, camera, speaker)
  flip to `$alert` red when their stream is muted; the mic pill picks
  up `data-speaking="true"` for a green pulse animation
  (`mx_CallMicIndicator_pulse`, ported from `mx_VideoFeed_mic_pulse`).
  Styling lives in `apps/web/res/css/views/voip/_CallMicIndicator.pcss`
  and is purely informational (`pointer-events: none`).

---

## New files

| File                                                                            | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/accessibility/KeyboardShortcutsCustomization.ts`                  | Store + capture helpers: `getUserShortcutOverrides`, `set/clearUserShortcutOverride`, `setUserShortcutCleared`, `isComboCleared`, `clearAllUserShortcutOverrides`, `get/setShortcutGlobal`, `getGlobalShortcutActions`, `captureCombo`, `comboCanBeGlobal`, `toElectronAccelerator`, `combosEqual`, `findConflicts`, `dispatchSyntheticKeyEvent`.                                                                                                                                                                                          |
| `apps/web/src/accessibility/GlobalShortcutsBridge.ts`                           | Renderer half of the desktop bridge. `startGlobalShortcutsBridge()` is called from `init.tsx::preparePlatform`. Sends `setGlobalShortcuts` IPC on settings change; reacts to `globalShortcutFired` by dispatching a synthetic `KeyboardEvent` at `document`.                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/components/views/settings/KeyboardShortcutEditor.tsx`             | Row component. Listens at `document` capture phase while recording; renders the edit trigger, Make-global toggle, Clear (`✕`), Reset (`↺`), and conflict warning.                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/src/audio/CallMuteTones.ts`                                           | `playMicToggleTone` / `playIncomingAudioToggleTone` — Web Audio sine blips. Shared `AudioContext`, resumed inside the user-gesture handler.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/src/voip/ElementCallShortcuts.ts`                                     | Document-level keydown bridge for the active Element Call (group) call. `startElementCallShortcuts()` is idempotent and called from `init.tsx::preparePlatform`. Resolves the current call via `CallStore.instance.connectedCalls`, calls `toggleMicrophoneMuted` / `toggleRemoteAudioMuted` on it, and plays the existing mute-tone cues.                                                                                                                                                                                                                     |
| `apps/web/src/components/views/voip/CallMicIndicator.tsx`                       | Two-pill overlay rendered via `React.createPortal` into `document.body`. Position-fixed-tracks the `mx_CallView` host div (ResizeObserver + window resize + `timeline_resize` dispatcher action, mirroring `PersistedElement.updateChildPosition`) and stacks at `z-index: 10` so it draws over the Element Call iframe (which `PersistedElement` mounts at body level with `z-index: 9`). Subscribes to `CallEvent.AudioMuteState` via `useTypedEventEmitterState` and renders Mic + Volume solid icons that turn red when the corresponding stream is muted. |
| `apps/web/res/css/views/voip/_CallMicIndicator.pcss`                            | Styles for the `CallMicIndicator` pills (`position: fixed`, `z-index: 10`, 24×24 circle, `$alert` muted variant, `pointer-events: none`).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/desktop/src/globalShortcuts.ts`                                           | Main-process registrar. Tracks its own registered set, unregisters before each new payload, silently skips combos already taken by the OS. Exposes `releaseGlobalShortcuts()` for `beforeQuit`.                                                                                                                                                                                                                                                                                                                                                                |
| `apps/desktop/src/windowAudio.ts`                                               | Per-application screenshare audio (Windows). `resolveAudioForSource(sourceId, shareAudio)` maps screen sources to system `"loopback"` and window sources to `{ id: "applicationLoopback:<pid>", name: "Application Audio" }` via Electron's raw-`{ id, name }` escape hatch; HWND→PID via one-shot PowerShell P/Invoke of `GetWindowThreadProcessId`.                                                                                                                                                                                                          |
| `apps/web/res/css/views/settings/tabs/user/_KeyboardUserSettingsTab.pcss`       | Layout for the recorder, the global toggle, conflict warning, and the Reset-all row. (Was a stub upstream; rewritten here.)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/src/accessibility/KeyboardShortcutsCustomization.test.ts` | Unit tests for the pure helpers (31 cases; co-located vitest, migrated from the old `test/unit-tests` path in the 2026-07 sync).                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## Modified files (vs upstream)

### Renderer

- `apps/web/src/KeyBindingsManager.ts` — `KeyCombo` gains optional `numpad`;
  `isKeyComboMatch` matches either `ev.key` or `unshiftedFromCode(ev.code, ev.key)`.
  Numpad-flagged combos require `ev.code.startsWith("Numpad")`. New exported
  helper: `unshiftedFromCode`.
- `apps/web/src/accessibility/KeyboardShortcutUtils.ts` —
  `getKeyboardShortcuts()` merges `Keyboard.userShortcuts` over the
  `KEYBOARD_SHORTCUTS` defaults.
- `apps/web/src/accessibility/KeyboardShortcuts.ts` — adds
  `KeyBindingAction.ToggleIncomingAudioInCall` (default `Ctrl/Cmd+Alt+D`,
  CALLS category, eligible for "Make global"). The factory comment explains
  the move off `Ctrl/Cmd+Shift+D`.
- `apps/web/src/components/views/settings/tabs/user/KeyboardUserSettingsTab.tsx`
  — swaps read-only rows for `KeyboardShortcutEditor` on editable actions,
  surfaces the Reset-all row, gates the global-eligibility filter to
  CALLS + NAVIGATION on desktop builds.
- `apps/web/src/components/views/settings/KeyboardShortcut.tsx` — prefixes
  the rendered combo with "Num" when `combo.numpad`.
- `apps/web/src/settings/Settings.tsx` — registers two new device-only
  settings: `Keyboard.userShortcuts` (`Record<string, KeyCombo>`) and
  `Keyboard.globalShortcuts` (`string[]`).
- `apps/web/src/LegacyCallHandler.tsx` — `incomingAudioMutedCalls` Set,
  `setIncomingAudioMuted` / `toggleIncomingAudioMuted` / `isIncomingAudioMuted`,
  and the `IncomingAudioMutedCallsChanged` event. Mirrors the existing
  silenced-calls plumbing.
- `apps/web/src/components/views/voip/AudioFeed.tsx` — accepts optional
  `muted` prop and forwards it to `<audio>.muted`.
- `apps/web/src/components/views/voip/AudioFeedArrayForLegacyCall.tsx` —
  subscribes to `IncomingAudioMutedCallsChanged` and forwards per-call mute
  state to each `AudioFeed`.
- `apps/web/src/components/views/voip/LegacyCallView.tsx` — handles
  `ToggleIncomingAudioInCall` in `onNativeKeyDown` (toggle + tone + show
  controls), calls `playMicToggleTone` on a successful mic flip, passes
  `audio: true` to `setScreensharingEnabled`, and threads `micFeed` /
  `hideMicIcon` through the 1:1 local-swap branch.
- `apps/web/src/components/views/voip/VideoFeed.tsx` — adds `micFeed` and
  `hideMicIcon` props, a `speaking` state, separate mic-source attach/detach
  (`updateMicSource`), split handlers (`onFeedMuteStateChanged` vs
  `onMicMuteStateChanged`), and the `data-speaking` overlay attribute.
- `apps/web/src/components/views/elements/DesktopCapturerSourcePicker.tsx`
  — exports `DesktopCapturerSourcePickerResult`; accepts `offerAudio` and
  `allowWindowAudio` props and renders the audio checkbox (window-tab byline
  and forced-off shareAudio only when `allowWindowAudio` is false);
  `onFinished` now returns `{ source, shareAudio }`. Also now fetches only
  the **active tab's** source type (was both) on a 1000ms (was 500ms)
  refresh, so it doesn't capture screens while you're on the window tab —
  capturing both every 500ms pegged the main process into a visible hang.
- `apps/web/src/vector/init.tsx` — calls `startGlobalShortcutsBridge()` and
  `startElementCallShortcuts()` from `preparePlatform`.
- `apps/web/src/stores/widgets/ElementWidgetActions.ts` — adds a fork-defined
  `MuteRemoteAudio = "io.element.mute_remote_audio"` enum value alongside
  upstream's `DeviceMute`. Same payload shape (`audio_enabled?`); requires a
  matching widget-side handler to actually mute remote audio.
- `apps/web/src/models/Call.ts` — adds `CallEvent.AudioMuteState` (and a
  matching handler-map entry) plus an exported `AudioMuteState` shape. On
  `ElementCall`: `_micMuted` / `_remoteAudioMuted` state with getters and
  `setMicrophoneMuted` / `toggleMicrophoneMuted` / `setRemoteAudioMuted` /
  `toggleRemoteAudioMuted` methods. `onJoin` now sends an empty `DeviceMute`
  to probe the widget's initial state; `onDeviceMute` reads
  `audio_enabled` from the request and mirrors it onto `_micMuted`.
- `apps/web/src/components/views/voip/CallView.tsx` — captures a ref on
  the `mx_CallView` div and passes it to `<CallMicIndicator />` (rendered
  only when the call is an `ElementCall`). The indicator itself portals to
  `document.body`; the ref is what it tracks for positioning.
- `apps/web/src/vector/platform/ElectronPlatform.tsx` — receives the
  `audioRequested` / `windowAudioSupported` payload on
  `openDesktopCapturerSourcePicker`, opens the picker with `offerAudio` /
  `allowWindowAudio`, and passes `shareAudio` through to the
  `callDisplayMediaCallback` IPC.
- `apps/web/res/css/views/voip/_VideoFeed.pcss` — `data-speaking="true"`
  rule + `@keyframes mx_VideoFeed_mic_pulse` for the pulse animation.
- `apps/web/src/i18n/strings/en_EN.json` — adds the keyboard-tab strings
  (`clear_shortcut`, `click_to_rebind`, `conflict_warning`, `global_*`,
  `press_key_combination`, `reset_all`, `reset_to_default`, `unbound`),
  the shortcut display names (`numpad_prefix`,
  `toggle_incoming_audio_mute`), the screenshare-audio strings
  (`screenshare_audio_label`, `screenshare_audio_byline_window`), and the
  `CallMicIndicator` a11y labels (`mic_indicator_muted`,
  `mic_indicator_unmuted`, `video_indicator_muted`,
  `video_indicator_unmuted`, `remote_audio_indicator_muted`,
  `remote_audio_indicator_unmuted`).
- `apps/web/res/css/_components.pcss` — registers
  `_CallMicIndicator.pcss`.

### Desktop / main process

- `apps/desktop/src/electron-main.ts` — imports `releaseGlobalShortcuts` and
  calls it from `beforeQuit`. The `setDisplayMediaRequestHandler` callback
  computes `audio: "loopback"` from `request.audioRequested` (skipped on
  Linux), forwards it to the wayland callback path, and includes
  `audioRequested` + `windowAudioSupported` (`process.platform === "win32"`)
  in the renderer-picker IPC payload.
- `apps/desktop/src/ipc.ts` — `callDisplayMediaCallback` now resolves the
  audio half via `resolveAudioForSource(source.id, shareAudio)`: system
  `"loopback"` for screen sources, per-application loopback for window
  sources on Windows, nothing otherwise. Also adds
  `getDesktopCapturerSourcesSafe`: on Windows it enumerates window sources
  **without thumbnails** (screens keep theirs) to dodge a native WGC
  window-thumbnail segfault under Electron 42 / Chromium 148, and surfaces
  each window's **app icon** as the thumbnail so window tiles aren't blank.
  Also centralises the `{ id, name, thumbnailURL }` serialisation. See
  BUILDING.md troubleshooting and the CLAUDE.md gotcha.
- `apps/desktop/src/windowAudio.ts` — **new file.** `resolveAudioForSource`
  plus the PowerShell-P/Invoke HWND→PID lookup behind it; builds the
  `applicationLoopback:<pid>` device-id object passed through Electron's
  raw-`{ id, name }` escape hatch. Windows-only by construction.
  Hands the result to upstream's `consumeDisplayMediaCallback()` (2026-09
  sync; replaced the old get/set pair) and wraps `getDesktopCapturerSources`
  in try/catch like upstream so a capturer failure returns `[]`.
- `apps/desktop/src/preload.cts` — whitelists the new IPC channels
  `setGlobalShortcuts` and `globalShortcutFired`.
- `apps/desktop/project.json` — `build:ts` outputs gain `lib/*.cjs` /
  `lib/*.d.cts` so an nx **cache replay** keeps `lib/preload.cjs`.
  Upstream's `lib/*.js` + `lib/*.d.ts` globs silently dropped the
  preload on replay, shipping an installer that fell back to the web
  platform (no `window.electron`). Upstream-able fix; see BUILDING.md
  troubleshooting.

### Tests

> **Vitest layout.** Tests are collected only as `src/**/*.test.{ts,tsx}`
> (2026-07 migration). As of the 2026-09 sync every upstream test the fork
> edits has been moved by upstream to that co-located layout and converted to
> `vi.*`; the fork's edits rode along via git rename detection. Only
> `KeyboardShortcutsCustomization.test.ts` is fork-authored.

- `apps/web/src/accessibility/KeyboardShortcutsCustomization.test.ts`
  — fork suite for the pure helpers (31 cases). Migrated from the old
  `test/unit-tests/…-test.ts` jest path to co-located vitest during the
  2026-07 sync (`import { describe, it, expect } from "vitest"`).
- `apps/web/src/components/views/elements/DesktopCapturerSourcePicker.test.tsx`
  — adds cases for `offerAudio`, the window-tab byline, `allowWindowAudio`,
  and the `{ source, shareAudio }` return shape.
- `apps/web/src/components/views/voip/VideoFeed.test.tsx`
  — feed mock gains `isSpeaking` (the fork's constructor reads it).
- `apps/web/src/components/views/voip/LegacyCallView.test.tsx`
  — every feed mock gains `isSpeaking`; upstream adds mocks without it, so
  each new upstream test here needs the line added or `VideoFeed` throws.
- `apps/web/src/vector/platform/ElectronPlatform.test.ts` —
  covers the new IPC payload shape (`audioRequested`, `offerAudio`, the
  third `callDisplayMediaCallback` argument).
- `apps/web/src/components/views/settings/tabs/user/__snapshots__/KeyboardUserSettingsTab.test.tsx.snap`
  — snapshot of the editable rows (upstream's file, regenerated as needed).

### Build tooling

- `package.json` (root) — removes the `devEngines.packageManager` block.
  Upstream's pnpm 11.2.2 self-manages its own version (driven by that block)
  by prepending a `packageManagerDependencies` document to `pnpm-lock.yaml`,
  producing a two-document YAML that nx 22.7.4's lockfile parser rejects
  (`expected a single document in the stream, but found more`), which breaks
  every nx-driven script (`nx build`, `pnpm -r lint:types`, `nx start`).
  Removing the block makes pnpm write a single-document lockfile. The real
  document is dropped. Install with `corepack pnpm@11.23.0 install`. This is a
  build-tooling workaround, not a feature — re-apply after any upstream merge
  that restores the block (see CLAUDE.md, pnpm-11/nx gotcha).
- `package.json` (root) — adds `"@typescript/old": "npm:typescript@6.0.3"` to
  `devDependencies` (2026-07 TS-6 sync). Upstream's `module-api` vite build
  `require.resolve("@typescript/old")`s an alias pnpm never hoists, so the
  webpack build fails with `Cannot find module '@typescript/old'`; the root
  alias links it where module-api can resolve it. Diverges the lockfile ~181
  lines from upstream. Build-tooling workaround — re-apply after any upstream
  merge (see CLAUDE.md, `@typescript/old` gotcha).
- `apps/desktop/project.json` — adds `lib/*.cjs` / `lib/*.d.cts` to `build:ts`
  outputs so cache replay keeps `preload.cjs`. Re-apply if upstream reverts it.
- `knip.ts` (root) — removes `@typescript/old` from `ignoreDependencies`.
  Upstream ignores it because upstream never lists it; the fork declares it as
  a real root devDependency, and knip (`--strict`) refuses an ignore entry for
  a listed dependency. Re-apply if upstream re-adds the entry.

---

## New surface

### Settings (`Settings.tsx`, both `LEVELS_DEVICE_ONLY_SETTINGS`)

| Setting                    | Type                                 | Default |
| -------------------------- | ------------------------------------ | ------- |
| `Keyboard.userShortcuts`   | `Record<KeyBindingAction, KeyCombo>` | `{}`    |
| `Keyboard.globalShortcuts` | `KeyBindingAction[]`                 | `[]`    |

### Key bindings

| Action                                 | Default          | Category | Globaliseable? |
| -------------------------------------- | ---------------- | -------- | -------------- |
| `KeyBinding.toggleIncomingAudioInCall` | `Ctrl/Cmd+Alt+D` | CALLS    | yes            |

### IPC channels (preload whitelist)

| Channel                               | Direction                  | Payload                                                            |
| ------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `setGlobalShortcuts`                  | renderer → main            | `Array<{ action, accelerator }>`                                   |
| `globalShortcutFired`                 | main → renderer            | `{ action }`                                                       |
| `openDesktopCapturerSourcePicker`     | main → renderer (existing) | now `{ audioRequested?: boolean; windowAudioSupported?: boolean }` |
| `callDisplayMediaCallback` (existing) | renderer → main            | now `(source, shareAudio: boolean)`                                |

### LegacyCallHandler

- Event: `LegacyCallHandlerEvent.IncomingAudioMutedCallsChanged`
- Methods: `setIncomingAudioMuted(callId, muted)`,
  `toggleIncomingAudioMuted(callId)`, `isIncomingAudioMuted(callId)`.

### ElementCall (group call model)

- Events:
    - `CallEvent.DeviceMuteState` — payload `{ micMuted, videoMuted, remoteAudioMuted }`.
    - `CallEvent.SpeakingState` — payload `boolean`.
- Getters: `micMuted`, `videoMuted`, `remoteAudioMuted`, `speaking`.
- Methods: `setMicrophoneMuted(muted): Promise<boolean>`,
  `toggleMicrophoneMuted(): Promise<boolean>`,
  `setVideoMuted(muted): Promise<boolean>`,
  `toggleVideoMuted(): Promise<boolean>`,
  `setRemoteAudioMuted(muted): void`,
  `toggleRemoteAudioMuted(): boolean`.

### Widget actions

- `ElementWidgetActions.MuteRemoteAudio = "io.element.mute_remote_audio"` —
  fork-defined toWidget action. Payload mirrors `DeviceMute`'s
  `{ audio_enabled?: boolean }`. No reply expected today; the host treats it
  as fire-and-forget and updates the local indicator immediately.
- `ElementWidgetActions.SpeakingState = "io.element.speaking_state"` —
  fork-defined fromWidget action. Payload `{ speaking: boolean }`. The host
  acks and emits `CallEvent.SpeakingState` to drive the mic-pill pulse.
  Vanilla Element Call does not emit this today; the host-side wiring
  lights up as soon as a custom EC build adopts it.

---

## Known limitations (deliberate scope cuts)

- **Element Call mic + camera toggles are wired up; incoming-audio and
  speaking-pulse require matching upstream handlers.** The
  `ElementCallShortcuts` bridge talks to the widget through
  `ElementWidgetActions.DeviceMute`, which Element Call already supports
  on both `audio_enabled` and `video_enabled` — so mic and camera
  shortcuts work in group calls today. The incoming-audio shortcut uses
  a fork-defined `io.element.mute_remote_audio` action and the speaking
  pulse listens for a fork-defined `io.element.speaking_state`
  fromWidget action; vanilla Element Call ignores unknown actions and
  doesn't emit the speaking signal, so the host-side pills/pulse stay
  static until matching widget-side support ships. Both action names
  are namespaced to avoid clashing with whatever upstream eventually
  adopts.
- **No mouse-button support.** Electron's `globalShortcut` is keyboard-only.
  Users remap mouse-side-buttons to F-keys (e.g. F13–F24) with vendor
  software instead, which is why the safe-function-key list includes
  those.
- **No tray persistence.** Closing the window quits the Element process, so
  global hotkeys stop working. Tray persistence is out of scope — minimise
  Element if you want global hotkeys live.
- **Cross-category conflict detection isn't surfaced.** `findConflicts`
  only inspects the current action's category. Binding
  `ToggleMicInCall` to `Ctrl+1` won't warn that
  `SwitchToSpaceByNumber` (NAVIGATION) also fires on that press.
- **Linux screenshare audio is intentionally disabled.** Electron's
  loopback behaviour is undefined on X11/Wayland, so the main-process
  handler returns `audio: undefined` on `process.platform === "linux"`.
- **Per-application (window-source) screenshare audio is Windows-only.**
  macOS would need the bundle-id flavour of the device id
  (`applicationLoopback:<bundle_id>[:<pid>]`, CoreAudio process taps,
  macOS 14.4+) plus a window→bundle-id lookup; untestable here, so the
  window-tab checkbox stays disabled on macOS. Also note the captured
  audio covers the window's whole _process tree_, and UWP windows resolve
  to `ApplicationFrameHost` rather than the real app.

---

## Upstream-sync conflict surface

Likely friction points when merging `upstream/develop`:

- `package.json` (root) — the removed `devEngines.packageManager` block and
  the added `@typescript/old` alias. A merge that re-adds the block
  re-introduces the two-document lockfile (breaks nx); dropping the alias breaks
  the module-api/webpack build. Both re-applied after every merge.
- `apps/desktop/project.json` — the `build:ts` outputs fix (`lib/*.cjs`).
  If a merge reverts it, cache-replayed builds ship without
  `lib/preload.cjs` and the installer regresses to the web platform.
- `apps/web/src/settings/Settings.tsx` — interface entries are
  alphabetically grouped; new neighbours of `Keyboard.*` will conflict.
- `apps/web/src/accessibility/KeyboardShortcuts.ts` — additions sit next
  to `ToggleWebcamInCall`; new CALLS-category bindings upstream will need
  re-applying.
- `apps/web/src/KeyBindingsManager.ts` — `isKeyComboMatch` was rewritten;
  upstream changes here need re-applying on top.
- `apps/web/src/i18n/strings/en_EN.json` — adjacent keyboard and voip keys.
- `apps/web/src/components/views/voip/VideoFeed.tsx` — significant lifecycle
  rewrite for the mic-source split; expect manual re-application.
- `apps/web/src/components/views/voip/LegacyCallView.tsx` — feed-render
  branches were threaded with `micFeed` / `hideMicIcon`.
- `apps/desktop/src/electron-main.ts` — the display-media handler signature
  is touched.
- `apps/web/src/stores/widgets/ElementWidgetActions.ts` — single enum
  addition (`MuteRemoteAudio`); low risk but conflicts if upstream adds
  adjacent values.
- `apps/web/src/models/Call.ts` — `CallEvent` enum and the `ElementCall`
  class body both gained members. Conflicts likely if upstream changes
  either.
- `apps/web/src/components/views/voip/CallView.tsx` — small render-tree
  addition for the indicator.
- `knip.ts` (root) — the `ignoreDependencies` list; see Build tooling.
- `apps/web/res/css/views/settings/tabs/user/_KeyboardUserSettingsTab.pcss`
  — upstream's stub tracks Compound token renames (`$spacing-*` was removed
  in 2026-09); the fork's rules must use `var(--cpd-space-*)`.
- `apps/web/src/components/views/voip/{LegacyCallView,VideoFeed}.test.tsx`,
  `apps/web/src/components/views/elements/DesktopCapturerSourcePicker.test.tsx`
  — co-located upstream tests with small fork edits; new upstream feed mocks
  need `isSpeaking`.

See `CLAUDE.md` for the upstream-sync command sequence and for repo
gotchas (`pnpm i18n` line-ending churn, `_components.pcss` CRLF noise,
`webapp/` build-output accumulation, etc.).

---

## See also

- **`CLAUDE.md`** — working brief for Claude sessions: the same change set
  framed as "what an agent needs to know to be useful on this fork", plus
  test commands, lint pipeline, and the long list of repo gotchas.
- **`BUILDING.md`** — release-build and installer steps for this fork.
