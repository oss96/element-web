# Progress — screenshare audio fixes

Branch: `feat/screenshare-audio-by-application` · Started: 2026-06-19

Tracking the screenshare issues reported in this session. Group calling is
**parked** per request; findings recorded below so it can be picked up later.

---

## Threads

### 1. Shared screenshare audio cuts out when I speak + sounds poor  ← ACTIVE
**Scope:** Legacy 1:1 calls. Symptom is the *shared system/app audio*, not video.
Confirmed by user: happens for **both** whole-screen and single-window shares;
the other party was on **headphones**.

**Root cause.** The fork requests screenshare audio as a bare `audio: true`
(`LegacyCallView.onScreenshareClick` → matrix-js-sdk `getScreensharingStream`
→ `getDisplayMedia`). With a bare boolean, Chromium captures the loopback track
with its default **voice processing on** (`echoCancellation`, `noiseSuppression`,
`autoGainControl`). Two consequences, both reported:

- **Cut-out when speaking:** the display/loopback audio track is routed through
  the **same audio-processing module (APM)** as the microphone. The AEC's
  far-end reference is the playout (the *other party's* incoming voice). During
  double-talk the AEC's non-linear suppressor ducks the whole shared track.
  This is independent of speakers-vs-headphones (digital) and of screen-vs-app
  loopback (both are display-audio tracks in the same APM) — matches all
  observations. *(Earlier "system loopback re-captures your voice" theory was
  discarded: it can't explain the per-application `applicationLoopback:<pid>`
  case, which never captures the call audio.)*
- **Poor quality:** `noiseSuppression` mangles music, `autoGainControl` pumps
  levels, and Opus defaults to mono/voice/low-bitrate.

**Fix (this change):** in `onScreenshareClick`, request the shared audio with
`echoCancellation/noiseSuppression/autoGainControl: false` (so it never joins
the mic APM → no ducking, clean media), then tune the captured track:
`contentHint = "music"` (full-band Opus, no DTX), re-assert no-processing via
`applyConstraints` (belt-and-braces), and best-effort raise the Opus
`maxBitrate` on the sender.

**Status:** ✅ implemented in `LegacyCallView.tsx` (module const
`SCREENSHARE_AUDIO_CONSTRAINTS`, request change in `onScreenshareClick`, new
`tuneScreenshareAudioTrack()`). eslint clean; tsc clean for fork/app code (only
the 4 known pre-existing matrix-js-sdk errors remain). **Still must be verified
on a real desktop build with a two-person call** — Electron/Chromium loopback
runtime behaviour that jest/jsdom cannot exercise.

### 2. Screenshare "can't be stopped" (two-track teardown)  ← RISK, coupled to #1
Working tree had a diagnostic reverting to **video-only** screenshare to test
whether the fork's two-track (video + loopback audio) stream was why sharing
couldn't be stopped (esp. mutual/sequential shares). Re-enabling audio for #1
**reintroduces** this risk.

Static read of the SDK stop path (`call.ts:1276-1291`) shows it *does* remove
both audio and video screenshare transceivers and stop the stream — no obvious
code defect; likely a renegotiation/timing issue if real. Not confirmable
statically and not reproducible here.

**Decision:** ship the audio fix; flag stop-behaviour as a top verification
item. If it recurs on the real build, investigate the transceiver
re-negotiation path (glare on removing two senders) next — do **not** add
speculative SDK workarounds blindly.

### 3. Element Call (group) calls "not available anymore"  ← PARKED
Not a fork-code regression. Availability gate is upstream
`useRoomCall.tsx:176-205`: needs `feature_group_calls` (Labs, default **off**),
permission to send the call member-state event, **and** the homeserver to
advertise a LiveKit RTC transport.

Live check: `ossalali.com/.well-known/matrix/client` **does** advertise
`org.matrix.msc4143.rtc_foci → https://livekit.ossalali.com`, so
`serverIsConfiguredForElementCall` should be **true**. Most likely cause is the
**`feature_group_calls` Labs toggle being off** (device-level setting; resets on
a fresh profile/install). 10-second check in Settings → Labs when resumed.
Fork's `Call.ts` DeviceMute/SpeakingState/onJoin code is wrapped/safe — ruled
out by the EC-availability investigation.

---

## Verification checklist (real desktop build, two participants)
- [ ] Share a window/app playing music — quality good, no NS/AGC artifacts.
- [ ] Talk while sharing audio — shared audio **does not** duck/cut out.
- [ ] Repeat for a whole-screen share.
- [ ] **Stop** the share cleanly; then start+stop again (sequential).
- [ ] Mutual share (both parties) can be stopped on both ends.

## Change log
- 2026-06-19: diagnosis complete.
- 2026-06-19: implemented #1 in `LegacyCallView.tsx` — capture with AEC/NS/AGC
  off, `contentHint="music"`, best-effort 256 kbps Opus; re-enabled audio
  (reverted the video-only diagnostic). Updated `CLAUDE.md` + `FORK_CHANGES.md`.
  eslint + tsc clean (fork/app code). Pending: real-build verification (incl.
  the can't-stop check) and the `feature_group_calls` Labs toggle for #3.
