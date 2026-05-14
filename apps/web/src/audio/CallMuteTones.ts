/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

// Short synthesized blips used to confirm mic / incoming-audio toggles. We use
// the Web Audio API rather than shipping mp3/ogg assets so the feedback has
// zero asset footprint and a distinct pitch can clearly signal "on" vs "off".

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
    if (sharedContext) return sharedContext;
    try {
        const Ctor =
            window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        sharedContext = new Ctor();
    } catch (err) {
        logger.warn("CallMuteTones: failed to construct AudioContext", err);
        return null;
    }
    return sharedContext;
}

function playTone(frequency: number, durationSec: number = 0.18): void {
    const ctx = getContext();
    if (!ctx) return;

    // The context may be suspended until the first user gesture; resume
    // synchronously so the tone fires from the same click/keydown.
    if (ctx.state === "suspended") {
        // Returns a Promise — ignored, we're already inside a user gesture
        // and the resume will land before the oscillator's stop time.
        void ctx.resume();
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;

    // Short attack, exponential decay — feels like a soft click rather than a beep.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
}

/**
 * Play a confirmation tone for a mic mute toggle.
 *
 * @param muted - the new state after the toggle. Lower pitch for "muted",
 *                higher pitch for "unmuted" — matches the universal convention
 *                where a higher tone reads as "going live".
 */
export function playMicToggleTone(muted: boolean): void {
    playTone(muted ? 440 : 880);
}

/**
 * Play a confirmation tone for an incoming-audio mute toggle. Slightly
 * different frequencies from the mic toggle so the two actions are aurally
 * distinct when fired in quick succession.
 */
export function playIncomingAudioToggleTone(muted: boolean): void {
    playTone(muted ? 330 : 660);
}
