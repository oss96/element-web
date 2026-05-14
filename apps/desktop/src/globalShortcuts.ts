/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Handles OS-level global hotkey registration on behalf of the renderer.
 *
 * The renderer (apps/web) is the source of truth for the user's keybind settings.
 * It pushes the resolved set of `{action, accelerator}` pairs here whenever the
 * relevant settings change. We unregister every previously-registered accelerator
 * and re-register the new set, with each handler firing a "globalShortcutFired"
 * IPC back to the renderer so the in-app action handlers can react.
 *
 * Silent failure modes (intentional):
 * - If an accelerator is already taken by another app or by the OS, `register`
 *   returns false. We just skip it; the renderer will see the action as
 *   not-firing and the user can pick a different combo.
 */

import { globalShortcut, ipcMain } from "electron";

type IpcMainEvent = Electron.IpcMainEvent;

interface RendererPayload {
    action: string;
    accelerator: string;
}

// Track what we've registered so unregister can hit just our set without
// stomping on anyone else's globalShortcut usage in the app (currently none).
const registeredAccelerators: Set<string> = new Set();

const unregisterAll = (): void => {
    for (const accelerator of registeredAccelerators) {
        try {
            globalShortcut.unregister(accelerator);
        } catch {
            // Already gone; nothing to do.
        }
    }
    registeredAccelerators.clear();
};

const isPayloadArray = (value: unknown): value is RendererPayload[] => {
    if (!Array.isArray(value)) return false;
    return value.every(
        (item) =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as RendererPayload).action === "string" &&
            typeof (item as RendererPayload).accelerator === "string",
    );
};

ipcMain.on("setGlobalShortcuts", (_event: IpcMainEvent, payload: unknown) => {
    unregisterAll();
    if (!isPayloadArray(payload)) return;

    for (const { action, accelerator } of payload) {
        if (registeredAccelerators.has(accelerator)) continue; // Last writer wins; first registration sticks.
        try {
            const ok = globalShortcut.register(accelerator, () => {
                global.mainWindow?.webContents.send("globalShortcutFired", action);
            });
            if (ok) registeredAccelerators.add(accelerator);
        } catch {
            // Invalid accelerator string — skip silently.
        }
    }
});

/** Called from electron-main's before-quit so we leave no dangling OS hotkeys. */
export const releaseGlobalShortcuts = (): void => {
    unregisterAll();
};
