/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Per-application screenshare audio (Windows only).
 *
 * Chromium ≥141 can capture the audio of a single process tree via the
 * Windows process-loopback API (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK).
 * The audio service recognises the magic input-device id
 * `applicationLoopback:<pid>` (media/audio/application_loopback_device_helper.cc)
 * and Electron's setDisplayMediaRequestHandler callback forwards an arbitrary
 * `{ id, name }` audio object verbatim into the media stack — an intentional,
 * but undocumented, "escape hatch" (electron_browser_context.cc). Together
 * these let us attach application audio to a window share without patching
 * Electron or shipping a native module.
 *
 * The only missing piece is mapping the picked window to its owning process:
 * desktopCapturer window source ids are `window:<HWND>:<n>`, and the HWND →
 * PID lookup (Win32 GetWindowThreadProcessId) has no Node binding. We shell
 * out to PowerShell with an inline P/Invoke instead — slow (~1s, dominated by
 * Add-Type's C# compile) but it only runs once per share-start.
 */

import { execFile } from "node:child_process";

import type { Streams } from "electron";

/** Matches `window:<HWND>:<disambiguation>` desktopCapturer source ids. */
const WINDOW_SOURCE_ID = /^window:(\d+):/;

const resolveWindowPid = (hwnd: string): Promise<number | null> => {
    // The HWND is interpolated into the script, so keep the regex-validated
    // digits-only guarantee from the caller. -EncodedCommand sidesteps every
    // layer of cmd/PowerShell argument-quoting trouble.
    const script = [
        "Add-Type -Namespace ElementWin32 -Name User32 -MemberDefinition " +
            "'[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);'",
        "$procId = [uint32]0",
        `[void][ElementWin32.User32]::GetWindowThreadProcessId([System.IntPtr]::new([int64]${hwnd}), [ref]$procId)`,
        "Write-Output $procId",
    ].join("; ");
    const encoded = Buffer.from(script, "utf16le").toString("base64");

    return new Promise((resolve) => {
        execFile(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
            { timeout: 10_000, windowsHide: true },
            (error, stdout) => {
                if (error) {
                    console.error("windowAudio: HWND->PID lookup failed:", error);
                    resolve(null);
                    return;
                }
                const pid = parseInt(stdout.trim(), 10);
                // GetWindowThreadProcessId leaves the out-param at 0 when the
                // HWND is stale (window closed between pick and share).
                resolve(Number.isFinite(pid) && pid > 0 ? pid : null);
            },
        );
    });
};

/**
 * Decide the audio half of the setDisplayMediaRequestHandler callback for a
 * picked source.
 *
 * - screen source → system-wide loopback (existing behaviour);
 * - window source on Windows → per-application loopback of the window's
 *   owning process tree, or no audio if the PID lookup fails (failing silent
 *   beats surprising the user with full system audio they didn't ask for);
 * - anything else → no audio.
 */
export const resolveAudioForSource = async (
    sourceId: string,
    shareAudio: boolean,
): Promise<Streams["audio"] | undefined> => {
    if (!shareAudio) return undefined;
    if (sourceId.startsWith("screen:")) return "loopback";

    const hwnd = WINDOW_SOURCE_ID.exec(sourceId)?.[1];
    if (!hwnd || process.platform !== "win32") return undefined;

    const pid = await resolveWindowPid(hwnd);
    if (pid === null) {
        console.error(`windowAudio: no PID for source ${sourceId}; sharing without audio`);
        return undefined;
    }

    // Not part of Electron's published Streams type — this rides the
    // raw-device-id escape hatch in electron_browser_context.cc. Re-verify it
    // survives every Electron major bump (see CLAUDE.md gotchas).
    return { id: `applicationLoopback:${pid}`, name: "Application Audio" } as unknown as Streams["audio"];
};
