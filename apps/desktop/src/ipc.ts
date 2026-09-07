/*
Copyright 2022-2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { app, autoUpdater, desktopCapturer, ipcMain, powerSaveBlocker, TouchBar, nativeImage } from "electron";

import IpcMainEvent = Electron.IpcMainEvent;
import { randomArray } from "./utils.js";
import { consumeDisplayMediaCallback } from "./displayMediaCallback.js";
import { resolveAudioForSource } from "./windowAudio.js";
import Store, { clearDataAndRelaunch } from "./store.js";
import { getConfig } from "./config.js";

type SourcesOptions = Electron.SourcesOptions;

interface CapturerSource {
    id: string;
    name: string;
    thumbnailURL: string;
}

/** Serialise a source to the `{ id, name, thumbnailURL }` shape the renderer expects. */
const toCapturerSource = (source: Electron.DesktopCapturerSource, preferIcon: boolean): CapturerSource => {
    // Window sources on Windows come back without a thumbnail (see below), so
    // fall back to the app icon there — a recognisable visual beats a blank
    // tile. The picker's <img> renders it at native size (48×48).
    const image = preferIcon && source.appIcon && !source.appIcon.isEmpty() ? source.appIcon : source.thumbnail;
    return { id: source.id, name: source.name, thumbnailURL: image.toDataURL() };
};

/**
 * Fetch desktop-capturer sources, working around a hard crash.
 *
 * On Windows (observed under Electron 42 / Chromium 148 with recent GPU
 * drivers) generating *window* thumbnails segfaults the capture/GPU path:
 * the primary GDI window capturer rejects some windows and Chromium falls
 * back to the WGC capturer (`allow_wgc_capturer_fallback(true)` is hardcoded
 * in content/public/browser/desktop_capture.cc), whose `CreateForWindow`
 * failure path crashes the process. A native segfault can't be caught in JS,
 * so we avoid triggering it: enumerate window sources *without* thumbnails
 * (a name-only enumeration never invokes WGC) and surface each window's app
 * icon instead. Screens keep their thumbnails. Non-Windows platforms are
 * unaffected and take the normal path (real thumbnails for both types).
 */
async function getDesktopCapturerSourcesSafe(options: SourcesOptions): Promise<CapturerSource[]> {
    const wantsWindows = options.types?.includes("window");
    if (process.platform !== "win32" || !wantsWindows) {
        return (await desktopCapturer.getSources(options)).map((s) => toCapturerSource(s, false));
    }

    const sources: CapturerSource[] = [];
    if (options.types?.includes("screen")) {
        const screens = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: options.thumbnailSize });
        sources.push(...screens.map((s) => toCapturerSource(s, false)));
    }
    const windows = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 0, height: 0 }, // no thumbnail → no WGC → no crash
        fetchWindowIcons: true, // show the app icon in place of the missing thumbnail
    });
    sources.push(...windows.map((s) => toCapturerSource(s, true)));
    return sources;
}

let focusHandlerAttached = false;
ipcMain.on("loudNotification", function (): void {
    if (process.platform === "win32" || process.platform === "linux") {
        if (global.mainWindow && !global.mainWindow.isFocused() && !focusHandlerAttached) {
            global.mainWindow.flashFrame(true);
            global.mainWindow.once("focus", () => {
                global.mainWindow?.flashFrame(false);
                focusHandlerAttached = false;
            });
            focusHandlerAttached = true;
        }
    }
});

let powerSaveBlockerId: number | null = null;
ipcMain.on("app_onAction", function (_ev: IpcMainEvent, payload) {
    switch (payload.action) {
        case "call_state": {
            if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
                if (payload.state === "ended") {
                    powerSaveBlocker.stop(powerSaveBlockerId);
                    powerSaveBlockerId = null;
                }
            } else {
                if (powerSaveBlockerId === null && payload.state === "connected") {
                    powerSaveBlockerId = powerSaveBlocker.start("prevent-display-sleep");
                }
            }
            break;
        }
    }
});

ipcMain.on("ipcCall", async function (_ev: IpcMainEvent, payload) {
    const store = Store.instance;
    if (!global.mainWindow || !store) return;

    const args = payload.args || [];
    let ret: any;

    switch (payload.name) {
        case "getUpdateFeedUrl":
            ret = autoUpdater.getFeedURL();
            break;
        case "setLanguage":
            global.appLocalization.setAppLocale(args[0]);
            break;
        case "getAppVersion":
            ret = app.getVersion();
            break;
        case "focusWindow":
            if (global.mainWindow.isMinimized()) {
                global.mainWindow.restore();
            } else {
                global.mainWindow.show();
                global.mainWindow.focus();
            }
            break;

        case "navigateBack":
            if (global.mainWindow.webContents.canGoBack()) {
                global.mainWindow.webContents.goBack();
            }
            break;
        case "navigateForward":
            if (global.mainWindow.webContents.canGoForward()) {
                global.mainWindow.webContents.goForward();
            }
            break;
        case "setSpellCheckEnabled":
            if (typeof args[0] !== "boolean") return;

            global.mainWindow.webContents.session.setSpellCheckerEnabled(args[0]);
            store.set("spellCheckerEnabled", args[0]);
            break;

        case "getSpellCheckEnabled":
            ret = store.get("spellCheckerEnabled");
            break;

        case "setSpellCheckLanguages":
            try {
                global.mainWindow.webContents.session.setSpellCheckerLanguages(args[0]);
            } catch (er) {
                console.log("There were problems setting the spellcheck languages", er);
            }
            break;

        case "getSpellCheckLanguages":
            ret = global.mainWindow.webContents.session.getSpellCheckerLanguages();
            break;
        case "getAvailableSpellCheckLanguages":
            ret = global.mainWindow.webContents.session.availableSpellCheckerLanguages;
            break;

        case "getPickleKey":
            try {
                ret = await store.getSecret(`${args[0]}|${args[1]}`);
            } catch {
                // An error is thrown if we can't initialise safeStorage, or if a stored secret exists
                // but can't be decrypted this launch (SafeStorageDecryptionError, e.g. the OS keychain
                // is temporarily unavailable). In both cases return null so the default pickle key is
                // used; we must NOT destroy the existing secret (see createPickleKey below) so the
                // session can recover on a later launch. See element-web#32521 / #32715.
                ret = null;
            }
            break;

        case "createPickleKey":
            try {
                // Never overwrite a pickle key that already exists but is currently undecryptable.
                // Overwriting it with a freshly-generated key would turn a transient keychain failure
                // into permanent session and encryption-key loss. Preserve it so the existing session
                // can be restored on a later launch once the keychain is readable again.
                if (await store.isSecretUndecryptable(`${args[0]}|${args[1]}`)) {
                    console.warn("Refusing to overwrite an existing undecryptable pickle key; preserving it");
                    ret = null;
                } else {
                    const pickleKey = await randomArray(32);
                    await store.setSecret(`${args[0]}|${args[1]}`, pickleKey);
                    ret = pickleKey;
                }
            } catch (e) {
                console.error("Failed to create pickle key", e);
                ret = null;
            }
            break;

        case "destroyPickleKey":
            try {
                await store.deleteSecret(`${args[0]}|${args[1]}`);
            } catch (e) {
                console.error("Failed to destroy pickle key", e);
            }
            break;
        case "getDesktopCapturerSources":
            try {
                ret = await getDesktopCapturerSourcesSafe(args[0]);
            } catch (e) {
                console.error("Failed to get desktop capturer sources", e);
                ret = [];
            }
            break;
        case "callDisplayMediaCallback": {
            // System loopback for screens, per-application loopback for windows
            // (Windows only) — see windowAudio.ts.
            const audio = await resolveAudioForSource(args[0]?.id ?? "", Boolean(args[1]));
            const streams: Electron.Streams = { video: args[0] };
            // Only attach the `audio` key when we actually have a device.
            // getDisplayMedia here is called with audio requested (so the
            // picker can offer the "Also share audio" checkbox), and Electron's
            // handler treats a *present* `audio` key — even `audio: undefined` —
            // as "audio supplied"; failing to parse it then rejects the whole
            // request with "Invalid capture constraints" (see the
            // `result_dict.Has("audio")` branch in electron_browser_context.cc).
            // Omitting the key entirely yields a clean video-only stream.
            if (audio) streams.audio = audio;
            consumeDisplayMediaCallback()?.(streams);
            ret = null;
            break;
        }

        case "clearStorage":
            await clearDataAndRelaunch(global.mainWindow.webContents.session);
            return; // the app is about to stop, we don't need to reply to the IPC

        case "breadcrumbs": {
            if (process.platform === "darwin") {
                const { TouchBarPopover, TouchBarButton } = TouchBar;

                const recentsBar = new TouchBar({
                    items: args[0].map((r: { roomId: string; avatarUrl: string | null; initial: string }) => {
                        const defaultColors = ["#0DBD8B", "#368bd6", "#ac3ba8"];
                        let total = 0;
                        for (let i = 0; i < r.roomId.length; ++i) {
                            total += r.roomId.charCodeAt(i);
                        }

                        const button = new TouchBarButton({
                            label: r.initial,
                            backgroundColor: defaultColors[total % defaultColors.length],
                            click: (): void => {
                                void global.mainWindow?.loadURL(`vector://vector/webapp/#/room/${r.roomId}`);
                            },
                        });
                        if (r.avatarUrl) {
                            void fetch(r.avatarUrl)
                                .then((resp) => {
                                    if (!resp.ok) return;
                                    return resp.arrayBuffer();
                                })
                                .then((arrayBuffer) => {
                                    if (!arrayBuffer) return;
                                    const buffer = Buffer.from(arrayBuffer);
                                    button.icon = nativeImage.createFromBuffer(buffer);
                                    button.label = "";
                                    button.backgroundColor = "";
                                });
                        }
                        return button;
                    }),
                });

                const touchBar = new TouchBar({
                    items: [
                        new TouchBarPopover({
                            label: "Recents",
                            showCloseButton: true,
                            items: recentsBar,
                        }),
                    ],
                });
                global.mainWindow.setTouchBar(touchBar);
            }
            break;
        }

        default:
            global.mainWindow.webContents.send("ipcReply", {
                id: payload.id,
                error: "Unknown IPC Call: " + payload.name,
            });
            return;
    }

    global.mainWindow?.webContents.send("ipcReply", {
        id: payload.id,
        reply: ret,
    });
});

ipcMain.handle("getConfig", getConfig);

const initialisePromiseWithResolvers = Promise.withResolvers<void>();
export const initialisePromise = initialisePromiseWithResolvers.promise;

ipcMain.once("initialise", () => {
    initialisePromiseWithResolvers.resolve();
});
