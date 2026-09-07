/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type FC, type RefObject, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
    MicOffSolidIcon,
    MicOnSolidIcon,
    VideoCallOffSolidIcon,
    VideoCallSolidIcon,
    VolumeOffSolidIcon,
    VolumeOnSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import { type DeviceMuteState, CallEvent, type ElementCall } from "../../../models/Call";
import { useTypedEventEmitterState } from "../../../hooks/useEventEmitter";
import dis from "../../../dispatcher/dispatcher";
import { type ActionPayload } from "../../../dispatcher/payloads";

interface Props {
    call: ElementCall;
    /** Ref to the `.mx_CallView` host div whose bounds the indicator tracks. */
    containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Small overlay that mirrors the active Element Call's mic, camera, and
 * incoming-audio mute state on the host page. The Element Call widget iframe
 * is rendered at `document.body` level by `PersistedElement` (with
 * `position: absolute` and `z-index: 9`), so an overlay nested inside
 * `mx_CallView` can never out-stack the iframe. Instead this component:
 *
 *   - portals itself into `document.body` next to the persisted iframe
 *   - position-fixed-tracks the `mx_CallView` host div via `getBoundingClientRect`,
 *     refreshed on ResizeObserver, window resize, and the `timeline_resize`
 *     dispatcher action — mirroring `PersistedElement.updateChildPosition`
 *   - sits at `z-index: 10` so it draws above the iframe
 *   - pulses the mic pill when `CallEvent.SpeakingState` reports the local
 *     participant is speaking and the mic isn't muted.
 */
export const CallMicIndicator: FC<Props> = ({ call, containerRef }) => {
    const computeMute = useCallback(
        (next?: DeviceMuteState): DeviceMuteState =>
            next ?? {
                micMuted: call.micMuted,
                videoMuted: call.videoMuted,
                remoteAudioMuted: call.remoteAudioMuted,
            },
        [call],
    );
    const state = useTypedEventEmitterState(call, CallEvent.DeviceMuteState, computeMute);

    const computeSpeaking = useCallback((next?: boolean): boolean => next ?? call.speaking, [call]);
    const speaking = useTypedEventEmitterState(call, CallEvent.SpeakingState, computeSpeaking);

    const [rect, setRect] = useState<DOMRect | null>(null);
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const update = (): void => setRect(container.getBoundingClientRect());
        update();

        const ro = new ResizeObserver(update);
        ro.observe(container);
        window.addEventListener("resize", update);
        const dispatcherRef = dis.register((payload: ActionPayload) => {
            if (payload.action === "timeline_resize") update();
        });

        return () => {
            ro.disconnect();
            window.removeEventListener("resize", update);
            dis.unregister(dispatcherRef);
        };
    }, [containerRef]);

    if (!rect) return null;

    const micLabel = state.micMuted ? _t("voip|mic_indicator_muted") : _t("voip|mic_indicator_unmuted");
    const videoLabel = state.videoMuted ? _t("voip|video_indicator_muted") : _t("voip|video_indicator_unmuted");
    const remoteLabel = state.remoteAudioMuted
        ? _t("voip|remote_audio_indicator_muted")
        : _t("voip|remote_audio_indicator_unmuted");

    const micSpeaking = speaking && !state.micMuted;

    return createPortal(
        <div
            className="mx_CallMicIndicator"
            aria-live="polite"
            style={{ top: rect.top + 12, left: rect.left + 12 }}
        >
            <span
                className="mx_CallMicIndicator_pill"
                data-muted={state.micMuted || undefined}
                data-speaking={micSpeaking || undefined}
                title={micLabel}
                aria-label={micLabel}
            >
                {state.micMuted ? <MicOffSolidIcon /> : <MicOnSolidIcon />}
            </span>
            <span
                className="mx_CallMicIndicator_pill"
                data-muted={state.videoMuted || undefined}
                title={videoLabel}
                aria-label={videoLabel}
            >
                {state.videoMuted ? <VideoCallOffSolidIcon /> : <VideoCallSolidIcon />}
            </span>
            <span
                className="mx_CallMicIndicator_pill"
                data-muted={state.remoteAudioMuted || undefined}
                title={remoteLabel}
                aria-label={remoteLabel}
            >
                {state.remoteAudioMuted ? <VolumeOffSolidIcon /> : <VolumeOnSolidIcon />}
            </span>
        </div>,
        document.body,
    );
};
