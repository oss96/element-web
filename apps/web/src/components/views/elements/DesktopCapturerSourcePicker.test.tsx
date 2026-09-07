/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import DesktopCapturerSourcePicker from "./DesktopCapturerSourcePicker";
import PlatformPeg from "../../../PlatformPeg";
import type BasePlatform from "../../../BasePlatform";

const SOURCES = [
    {
        id: "screen1",
        name: "Screen 1",
        thumbnailURL: "data:image/png;base64,",
    },
    {
        id: "window1",
        name: "Window 1",
        thumbnailURL: "data:image/png;base64,",
    },
];

describe("DesktopCapturerSourcePicker", () => {
    beforeEach(() => {
        const plaf = {
            getDesktopCapturerSources: vi.fn().mockResolvedValue(SOURCES),
            supportsSetting: vi.fn().mockReturnValue(false),
        };
        vi.spyOn(PlatformPeg, "get").mockReturnValue(plaf as unknown as BasePlatform);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should render the component", () => {
        render(<DesktopCapturerSourcePicker onFinished={() => {}} />);
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    });

    it("should disable share button until a source is selected", () => {
        render(<DesktopCapturerSourcePicker onFinished={() => {}} />);
        expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    });

    it("should contain a screen source in the default tab", async () => {
        render(<DesktopCapturerSourcePicker onFinished={() => {}} />);

        const screen1Button = await screen.findByRole("button", { name: "Screen 1" });

        expect(screen1Button).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Window 1" })).not.toBeInTheDocument();
    });

    it("should contain a window source in the window tab", async () => {
        render(<DesktopCapturerSourcePicker onFinished={() => {}} />);

        await userEvent.click(screen.getByRole("tab", { name: "Application window" }));

        const window1Button = await screen.findByRole("button", { name: "Window 1" });

        expect(window1Button).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Screen 1" })).not.toBeInTheDocument();
    });

    it("should call onFinished with no arguments if cancelled", async () => {
        const onFinished = vi.fn();
        render(<DesktopCapturerSourcePicker onFinished={onFinished} />);

        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onFinished).toHaveBeenCalledWith();
    });

    it("should call onFinished with the selected source when share clicked", async () => {
        const onFinished = vi.fn();
        render(<DesktopCapturerSourcePicker onFinished={onFinished} />);

        const screen1Button = await screen.findByRole("button", { name: "Screen 1" });

        await userEvent.click(screen1Button);
        await userEvent.click(screen.getByRole("button", { name: "Share" }));
        expect(onFinished).toHaveBeenCalledWith({ source: SOURCES[0], shareAudio: false });
    });

    it("should not render the audio checkbox when offerAudio is unset", () => {
        render(<DesktopCapturerSourcePicker onFinished={() => {}} />);
        expect(screen.queryByRole("checkbox", { name: "Also share audio" })).not.toBeInTheDocument();
    });

    it("should render the audio checkbox when offerAudio is true", () => {
        render(<DesktopCapturerSourcePicker onFinished={() => {}} offerAudio={true} />);
        expect(screen.getByRole("checkbox", { name: "Also share audio" })).toBeInTheDocument();
    });

    it("should return shareAudio: true when the user opts in and picks a screen", async () => {
        const onFinished = vi.fn();
        render(<DesktopCapturerSourcePicker onFinished={onFinished} offerAudio={true} />);

        const screen1Button = await screen.findByRole("button", { name: "Screen 1" });
        await userEvent.click(screen1Button);
        await userEvent.click(screen.getByRole("checkbox", { name: "Also share audio" }));
        await userEvent.click(screen.getByRole("button", { name: "Share" }));

        expect(onFinished).toHaveBeenCalledWith({ source: SOURCES[0], shareAudio: true });
    });

    it("should disable the audio checkbox and force shareAudio off on the window tab", async () => {
        const onFinished = vi.fn();
        render(<DesktopCapturerSourcePicker onFinished={onFinished} offerAudio={true} />);

        // Tick the audio checkbox while still on the Screens tab.
        await userEvent.click(screen.getByRole("checkbox", { name: "Also share audio" }));

        // Switch to Windows tab — checkbox should disable and forcing shareAudio off.
        await userEvent.click(screen.getByRole("tab", { name: "Application window" }));
        const checkbox = screen.getByRole("checkbox", { name: "Also share audio" });
        expect(checkbox).toBeDisabled();

        const window1Button = await screen.findByRole("button", { name: "Window 1" });
        await userEvent.click(window1Button);
        await userEvent.click(screen.getByRole("button", { name: "Share" }));

        expect(onFinished).toHaveBeenCalledWith({ source: SOURCES[1], shareAudio: false });
    });
});
