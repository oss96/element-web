---
name: sync-fork-from-upstream
description: >-
  Sync this oss96/element-web fork from upstream element-hq/element-web:
  audit the fork's changes, preview and detect textual + semantic conflicts,
  merge upstream/develop, resolve conflicts, re-apply the mandatory
  fork-specific fixups, and verify the fork's custom features still survive
  (not just that it compiles). Use when the user asks to sync/merge/rebase
  from upstream, "pull in upstream changes", or on a session-start sync check.
---

# Sync fork from upstream

Automates the upstream sync + verify workflow for the `oss96/element-web`
fork. Upstream is `element-hq/element-web@develop`; the fork is
fast-forward-only against it.

The whole point of this skill is that **merging upstream cleanly (no git
conflicts) does NOT mean the fork still works.** Several fork behaviours break
*semantically* without producing any textual conflict. This skill exists to
catch those.

## Ground rules (read before running anything)

- **Ask before starting.** Confirm the user actually wants to sync now. Never
  run the merge unprompted. (Matches the session-start sync-check memory —
  that ask should offer to invoke *this* skill.)
- **Never read secrets.** For any Matrix login needed to test, ask the user to
  enter credentials in-app themselves. Do not open `.env`, credential stores,
  or echo tokens.
- **Docs are part of the diff.** If the merge changes fork behaviour or files,
  update `CLAUDE.md` + `FORK_CHANGES.md` in the same pass (and `BUILDING.md`
  if the build flow shifted). Update the "Last full sync" line in CLAUDE.md.
- **The source-of-truth "list of fork changes" already exists.** It is
  `FORK_CHANGES.md` (file-level inventory) + CLAUDE.md's "What this fork adds"
  and "Likely conflict sites" sections. Read those — do not invent a competing
  list. Refresh them if they are stale.

---

## Phase 0 — Preconditions & safety net

Merging is hard to reverse. Establish an escape hatch first.

1. `git status` — the tree is often **dirty** on this fork (CLAUDE.md,
   FORK_CHANGES.md, LegacyCallView.tsx, _components.pcss, progress.md commonly
   show modified). **Do not merge into a dirty tree.** Either:
   - ask the user whether to commit the pending work first, or
   - `git stash push -u` and record that you stashed (restore after).
2. Record the current branch and pre-merge SHA: `git rev-parse HEAD`. This is
   the abort target (`git merge --abort`, or `git reset --hard <SHA>`).
3. Confirm remotes: `git remote -v` must show `upstream` →
   `element-hq/element-web`. Add it if missing.
4. `git fetch upstream`.

## Phase 1 — Audit the fork surface (the "list")

1. Read `FORK_CHANGES.md` and CLAUDE.md's "What this fork adds" +
   "Likely conflict sites" sections. This is the inventory of what must
   survive.
2. Sanity-check it against reality: `git diff --stat <merge-base>..HEAD` where
   `<merge-base> = git merge-base HEAD upstream/develop`. If files changed that
   aren't reflected in FORK_CHANGES.md, note the drift and refresh the doc.

## Phase 2 — Pre-merge conflict preview (informational)

Real git conflicts only surface at merge time, but preview the likely trouble
first so nothing is a surprise:

1. See what upstream touched in the known conflict-prone files:
   ```
   git diff HEAD...upstream/develop -- \
     package.json \
     apps/desktop/src/project.json \
     apps/web/src/settings/Settings.tsx \
     apps/web/src/i18n/strings/en_EN.json \
     apps/web/src/accessibility/KeyboardShortcutUtils.ts \
     apps/web/src/KeyBindingsManager.ts \
     apps/web/src/stores/widgets/ElementWidgetActions.ts \
     apps/web/src/models/Call.ts \
     apps/web/src/components/views/voip/CallView.tsx
   ```
2. Scan the upstream log for anything that touches the fork's fragile spots
   (`git log --oneline HEAD..upstream/develop`), especially: pnpm/nx version
   bumps, Electron major bumps, keybinding refactors, Element Call / widget
   action changes.
3. Classify each likely conflict:
   - **Upstream replaced a feature the fork also customised** → plan to keep
     the upstream version (the fork's bespoke version is superseded); note it
     so the fork docs can drop the now-redundant customisation.
   - **Upstream change could break fork behaviour without conflicting** →
     record it in the sync report (Phase 6) as a semantic-risk item to verify.

## Phase 3 — Merge

1. `git merge upstream/develop` (fork is ff-only; rebase is equivalent).
2. If it merges clean, continue. If conflicts appear, go to Phase 4.
3. If anything looks wrong and you're unsure, you can bail:
   `git merge --abort` returns to the pre-merge SHA.

## Phase 4 — Resolve conflicts

For each conflicted file:

- Apply the Phase-2 classification: keep upstream's version where it replaced a
  fork feature; re-apply the fork's logic on top where the fork intentionally
  diverges (see FORK_CHANGES.md "Modified vs upstream" for what each change is
  *for* — resolve to preserve intent, not just to make git happy).
- **When genuinely unsure how to resolve, ask the user** via the
  AskUserQuestion tool with concrete options (keep-fork / take-upstream /
  merge-both), never guess on semantically important files like
  `KeyBindingsManager.ts`, `Call.ts`, `Settings.tsx`.
- Do **not** commit the merge until Phase 5's mandatory fixups are in and the
  build is green.

## Phase 5 — Mandatory fork fixups (the semantic layer)

These are NOT optional and often have **no git conflict** to remind you. Run
through every item after every merge:

1. **Re-strip `devEngines.packageManager`** from root `package.json` if the
   merge re-added/edited it. Then regenerate a single-document lockfile:
   `sed -i '1,199d' pnpm-lock.yaml` to drop the stale first YAML doc if a
   two-document lockfile appears, then
   `corepack pnpm@11.2.2 install --config.confirmModulesPurge=false`.
   (If the merge kept the fork's single-doc lockfile, just install.)
2. **`apps/desktop/src/project.json` build:ts outputs** must still include
   `lib/*.cjs` / `lib/*.d.cts` (else `preload.cjs` is dropped and the app
   falls back to the web platform). Re-apply if upstream reverted it.
3. **Electron major bump?** Re-verify the `applicationLoopback` escape hatch:
   grep upstream's `shell/browser/electron_browser_context.cc` for
   `escape hatch`. If gone, flag `windowAudio.ts` as broken in the report.
4. **`isKeyComboMatch` / KeyBindingsManager** — if upstream rewrote it,
   re-apply the fork's numpad-aware / `unshiftedFromCode` logic.
5. **CRLF / i18n noise cleanup** before committing:
   - `apps/web/res/css/_components.pcss` line-ending flip → revert if only EOL
     changed.
   - After any `pnpm i18n`, revert every `strings/*.json` except `en_EN.json`:
     `git diff --numstat apps/web/src/i18n/strings/ | awk '$1==0 && $2==0 {print $3}'`
     then `git checkout --` those. Replace any placeholder new-key values in
     `en_EN.json` with real English text.

## Phase 6 — Verify (the feature-survival ladder)

Compiling is not surviving. Climb the ladder; record results in the report.

Know the **expected baseline** so known-broken upstream state isn't misread as
a fork regression (re-check CLAUDE.md, these move):
- `pnpm exec jest` may be **unable to run at all** (SDK pin breaks setup).
- `pnpm -r lint:types` may report a **small number of errors that are all
  inside `matrix-js-sdk`**, none in fork/app code.

Ladder:
1. `pnpm -r lint:types` — new errors *in fork/app files* are real regressions;
   pre-existing SDK-only errors are the baseline.
2. `pnpm -r lint:js` and `pnpm lint:style` and `pnpm lint:prettier`.
3. `pnpm exec jest --testPathPatterns="(KeyBinding|Keyboard)"` if jest runs at
   all — the fork's own suite (41 tests / 5 suites).
4. **Webpack build must be green:** `pnpm --filter element-web build`
   (transpiles rather than type-checks, so it survives the SDK-pin type
   errors). This is the real "does it build" gate.
5. **Feature-survival checklist**, mapped to FORK_CHANGES.md — confirm each
   fork feature's code is still present and coherent post-merge (grep for the
   key symbols: `getUserShortcutOverrides`, `resolveAudioForSource`,
   `startElementCallShortcuts`, `CallMicIndicator`, `ToggleIncomingAudioInCall`,
   `MuteRemoteAudio`, `DeviceMuteState`).

## Phase 7 — Runtime testing

Be realistic about what can be automated:

- **Desktop-only features CANNOT be browser-tested.** globalShortcut,
  `windowAudio.ts` per-app screenshare audio, the display-media picker, and the
  asar/preload integrity all require a packaged **desktop build** (see
  BUILDING.md). If the user wants these verified, do a clean desktop build and
  drive `Element.exe` — flag that it's heavier.
- **Web-runtime pieces CAN be browser-tested** via the claude-in-chrome MCP:
  run the dev server (mind the `nx start` shared-components race — pre-build
  the shared-components dist and run webpack-dev-server directly), log in, and
  exercise the keyboard-settings tab, in-call indicator, and shortcut rebinding.
- **Credentials:** if a Matrix login is needed, ask the user via
  AskUserQuestion to enter it in-app themselves — never read or handle the
  secret.

## Phase 8 — Report & document

1. Write a dated **sync report** (`sync-report.md`, or a dated section
   appended to it) covering: upstream range merged (`old..new` SHAs), conflicts
   and how each was resolved, any features upstream superseded, semantic-risk
   items and their verification outcome, and anything left broken (e.g. escape
   hatch gone).
2. Update `CLAUDE.md`'s "Last full sync" line (date + upstream SHA + notable
   version bumps) and `FORK_CHANGES.md` for any file whose role changed.
3. **Commit only when the user confirms** the result works (global rule: don't
   commit until explicitly approved). Restore any Phase-0 stash first.
