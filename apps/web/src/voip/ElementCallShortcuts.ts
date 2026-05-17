/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Document-level keybinding bridge for Element Call (group) calls.
 *
 * Mirrors what LegacyCallView's `onNativeKeyDown` does for one-on-one calls,
 * but reaches the active widget-backed group call via `CallStore` and the
 * widget API. Runs even when no CallView is mounted (e.g. the call is in PiP
 * or the user is viewing a different room), so global hotkeys fired by
 * `GlobalShortcutsBridge` reach the right handler regardless of the active
 * view.
 *
 * Bails out cleanly when no `ElementCall` is in `CallStore.connectedCalls`,
 * leaving the existing legacy handler to win for one-on-one calls.
 *
 * NB: heavyweight modules (Call model, CallStore, mute-tone synth) are
 * imported lazily inside the handler. Pulling them in at module top-level
 * forces stores like `WidgetLayoutStore` to evaluate during early init,
 * which triggers a TDZ chain against `MatrixClientPeg`.
 */

import { getKeyBindingsManager } from "../KeyBindingsManager";
import { KeyBindingAction } from "../accessibility/KeyboardShortcuts";
import type { ElementCall as ElementCallType } from "../models/Call";

let started = false;

const onKeyDown = (ev: KeyboardEvent): void => {
    const action = getKeyBindingsManager().getCallAction(ev);
    if (
        action !== KeyBindingAction.ToggleMicInCall &&
        action !== KeyBindingAction.ToggleWebcamInCall &&
        action !== KeyBindingAction.ToggleIncomingAudioInCall
    ) {
        return;
    }

    void (async () => {
        const [{ CallStore }, { ElementCall }, { playIncomingAudioToggleTone, playMicToggleTone }] = await Promise.all([
            import("../stores/CallStore"),
            import("../models/Call"),
            import("../audio/CallMuteTones"),
        ]);

        // Prefer the one currently presented to the user, fall back to any
        // connected ElementCall — there is never expected to be more than one.
        // `ElementCall` has a private constructor so `InstanceType<typeof ElementCall>`
        // isn't usable; use the type-only import instead.
        let call: ElementCallType | null = null;
        for (const c of CallStore.instance.connectedCalls) {
            if (!(c instanceof ElementCall)) continue;
            if (c.presented) {
                call = c;
                break;
            }
            if (!call) call = c;
        }
        if (!call) return;

        if (action === KeyBindingAction.ToggleMicInCall) {
            const muted = await call.toggleMicrophoneMuted();
            playMicToggleTone(muted);
        } else if (action === KeyBindingAction.ToggleWebcamInCall) {
            // No audible cue here — mirrors LegacyCallView.onVidMuteClick.
            await call.toggleVideoMuted();
        } else {
            const muted = call.toggleRemoteAudioMuted();
            playIncomingAudioToggleTone(muted);
        }
    })();

    ev.stopPropagation();
    ev.preventDefault();
};

export const startElementCallShortcuts = (): void => {
    if (started) return;
    started = true;
    document.addEventListener("keydown", onKeyDown);
};
