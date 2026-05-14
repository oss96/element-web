/*
Copyright 2024 New Vector Ltd.
Copyright 2021 Šimon Brandner <simon.bra.ag@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import classNames from "classnames";

import { _t, _td } from "../../../languageHandler";
import BaseDialog from "..//dialogs/BaseDialog";
import DialogButtons from "./DialogButtons";
import AccessibleButton from "./AccessibleButton";
import LabelledCheckbox from "./LabelledCheckbox";
import TabbedView, { Tab, TabLocation } from "../../structures/TabbedView";
import PlatformPeg from "../../../PlatformPeg";
import { type NonEmptyArray } from "../../../@types/common";

export interface DesktopCapturerSourcePickerResult {
    source: DesktopCapturerSource;
    shareAudio: boolean;
}

export function getDesktopCapturerSources(): Promise<Array<DesktopCapturerSource>> {
    const options: GetSourcesOptions = {
        thumbnailSize: {
            height: 176,
            width: 312,
        },
        types: ["screen", "window"],
    };
    const plaf = PlatformPeg.get();
    return plaf ? plaf?.getDesktopCapturerSources(options) : Promise.resolve<DesktopCapturerSource[]>([]);
}

export enum Tabs {
    Screens = "screen",
    Windows = "window",
}

export interface ExistingSourceIProps {
    source: DesktopCapturerSource;
    onSelect(source: DesktopCapturerSource): void;
    selected: boolean;
}

export class ExistingSource extends React.Component<ExistingSourceIProps> {
    private onClick = (): void => {
        this.props.onSelect(this.props.source);
    };

    public render(): React.ReactNode {
        const thumbnailClasses = classNames({
            mx_desktopCapturerSourcePicker_source_thumbnail: true,
            mx_desktopCapturerSourcePicker_source_thumbnail_selected: this.props.selected,
        });

        return (
            <AccessibleButton
                className="mx_desktopCapturerSourcePicker_source"
                title={this.props.source.name}
                onClick={this.onClick}
            >
                <img alt={this.props.source.name} className={thumbnailClasses} src={this.props.source.thumbnailURL} />
                <span className="mx_desktopCapturerSourcePicker_source_name">{this.props.source.name}</span>
            </AccessibleButton>
        );
    }
}

export interface PickerIState {
    selectedTab: Tabs;
    sources: Array<DesktopCapturerSource>;
    selectedSource?: DesktopCapturerSource;
    shareAudio: boolean;
}
export interface PickerIProps {
    /**
     * Whether the underlying getDisplayMedia() call requested audio. When true,
     * the picker exposes an "Also share audio" checkbox; the user's choice is
     * returned via {@link DesktopCapturerSourcePickerResult.shareAudio}.
     */
    offerAudio?: boolean;
    onFinished(result?: DesktopCapturerSourcePickerResult): void;
}

export default class DesktopCapturerSourcePicker extends React.Component<PickerIProps, PickerIState> {
    public interval?: number;

    public constructor(props: PickerIProps) {
        super(props);

        this.state = {
            selectedTab: Tabs.Screens,
            sources: [],
            shareAudio: false,
        };
    }

    public async componentDidMount(): Promise<void> {
        // window.setInterval() first waits and then executes, therefore
        // we call getDesktopCapturerSources() here without any delay.
        // Otherwise the dialog would be left empty for some time.
        this.setState({
            sources: await getDesktopCapturerSources(),
        });

        // We update the sources every 500ms to get newer thumbnails
        this.interval = window.setInterval(async (): Promise<void> => {
            this.setState({
                sources: await getDesktopCapturerSources(),
            });
        }, 500);
    }

    public componentWillUnmount(): void {
        clearInterval(this.interval);
    }

    private onSelect = (source: DesktopCapturerSource): void => {
        this.setState({ selectedSource: source });
    };

    private onShare = (): void => {
        if (!this.state.selectedSource) return;
        // Audio loopback only works for entire screens on Windows/Chromium; an
        // audio track for a window source would just be silent. Force it off
        // for window sources so we don't return a misleading "shareAudio: true".
        const shareAudio = this.state.selectedTab === Tabs.Screens && this.state.shareAudio;
        this.props.onFinished({ source: this.state.selectedSource, shareAudio });
    };

    private onTabChange = (tab: Tabs): void => {
        this.setState({ selectedSource: undefined, selectedTab: tab });
    };

    private onAudioChange = (checked: boolean): void => {
        this.setState({ shareAudio: checked });
    };

    private onCloseClick = (): void => {
        this.props.onFinished();
    };

    private getTab(type: Tabs, label: TranslationKey): Tab<Tabs> {
        const sources = this.state.sources
            .filter((source) => source.id.startsWith(type))
            .map((source) => {
                return (
                    <ExistingSource
                        selected={this.state.selectedSource?.id === source.id}
                        source={source}
                        onSelect={this.onSelect}
                        key={source.id}
                    />
                );
            });

        return new Tab(type, label, null, <div className="mx_desktopCapturerSourcePicker_tab">{sources}</div>);
    }

    public render(): React.ReactNode {
        const tabs: NonEmptyArray<Tab<Tabs>> = [
            this.getTab(Tabs.Screens, _td("voip|screenshare_monitor")),
            this.getTab(Tabs.Windows, _td("voip|screenshare_window")),
        ];

        const audioOnlyOnScreenTab = this.state.selectedTab !== Tabs.Screens;

        return (
            <BaseDialog
                className="mx_desktopCapturerSourcePicker"
                onFinished={this.onCloseClick}
                title={_t("voip|screenshare_title")}
            >
                <TabbedView
                    tabs={tabs}
                    tabLocation={TabLocation.TOP}
                    activeTabId={this.state.selectedTab}
                    onChange={this.onTabChange}
                />
                {this.props.offerAudio && (
                    <LabelledCheckbox
                        className="mx_desktopCapturerSourcePicker_audio"
                        label={_t("voip|screenshare_audio_label")}
                        byline={
                            audioOnlyOnScreenTab ? _t("voip|screenshare_audio_byline_window") : undefined
                        }
                        value={this.state.shareAudio && !audioOnlyOnScreenTab}
                        disabled={audioOnlyOnScreenTab}
                        onChange={this.onAudioChange}
                    />
                )}
                <DialogButtons
                    primaryButton={_t("action|share")}
                    hasCancel={true}
                    onCancel={this.onCloseClick}
                    onPrimaryButtonClick={this.onShare}
                    primaryDisabled={!this.state.selectedSource}
                />
            </BaseDialog>
        );
    }
}
