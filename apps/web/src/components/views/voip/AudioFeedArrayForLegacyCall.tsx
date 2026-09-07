/*
Copyright 2024 New Vector Ltd.
Copyright 2021 Šimon Brandner <simon.bra.ag@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { CallEvent, type MatrixCall } from "matrix-js-sdk/src/webrtc/call";
import { type CallFeed } from "matrix-js-sdk/src/webrtc/callFeed";

import AudioFeed from "./AudioFeed";
import { LegacyCallHandlerEvent } from "../../../LegacyCallHandler";
import { SDKContextClass } from "../../../contexts/SDKContextClass.ts";

interface IProps {
    call: MatrixCall;
}

interface IState {
    feeds: Array<CallFeed>;
    incomingAudioMuted: boolean;
}

export default class AudioFeedArrayForLegacyCall extends React.Component<IProps, IState> {
    public constructor(props: IProps) {
        super(props);

        this.state = {
            feeds: this.props.call.getRemoteFeeds(),
            incomingAudioMuted: SDKContextClass.instance.legacyCallHandler.isIncomingAudioMuted(this.props.call.callId),
        };
    }

    public componentDidMount(): void {
        this.props.call.addListener(CallEvent.FeedsChanged, this.onFeedsChanged);
        SDKContextClass.instance.legacyCallHandler.addListener(
            LegacyCallHandlerEvent.IncomingAudioMutedCallsChanged,
            this.onIncomingAudioMutedChanged,
        );
    }

    public componentWillUnmount(): void {
        this.props.call.removeListener(CallEvent.FeedsChanged, this.onFeedsChanged);
        SDKContextClass.instance.legacyCallHandler.removeListener(
            LegacyCallHandlerEvent.IncomingAudioMutedCallsChanged,
            this.onIncomingAudioMutedChanged,
        );
    }

    public onFeedsChanged = (): void => {
        this.setState({
            feeds: this.props.call.getRemoteFeeds(),
        });
    };

    private onIncomingAudioMutedChanged = (): void => {
        this.setState({
            incomingAudioMuted: SDKContextClass.instance.legacyCallHandler.isIncomingAudioMuted(this.props.call.callId),
        });
    };

    public render(): JSX.Element[] {
        return this.state.feeds.map((feed) => {
            return <AudioFeed feed={feed} muted={this.state.incomingAudioMuted} key={feed.deviceId + feed.userId} />;
        });
    }
}
