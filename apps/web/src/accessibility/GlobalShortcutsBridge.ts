/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Bridge between the renderer's SettingsStore and the Electron main process's
 * `globalShortcut` API. Only does anything in desktop builds; on a regular web
 * build the import is inert.
 *
 * - On settings change (Keyboard.userShortcuts or Keyboard.globalShortcuts), recomputes
 *   the active set of global shortcuts and sends them to main via the
 *   "setGlobalShortcuts" IPC channel.
 * - On "globalShortcutFired" IPC from main, synthesises a KeyboardEvent so the
 *   existing in-app handlers (e.g. LegacyCallView's mic-toggle) react as if the
 *   user had pressed the combo while Element was focused.
 */

import { type KeyBindingAction } from "./KeyboardShortcuts";
import { getKeyboardShortcutValue } from "./KeyboardShortcutUtils";
import {
    dispatchSyntheticKeyEvent,
    getGlobalShortcutActions,
    toElectronAccelerator,
} from "./KeyboardShortcutsCustomization";
import SettingsStore from "../settings/SettingsStore";

type ElectronBridge = {
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
};

const getElectron = (): ElectronBridge | null => {
    if (typeof window === "undefined") return null;
    const candidate = (window as unknown as { electron?: ElectronBridge }).electron;
    return candidate ?? null;
};

interface GlobalShortcutPayload {
    action: KeyBindingAction;
    accelerator: string;
}

const computeGlobalsPayload = (): GlobalShortcutPayload[] => {
    const payload: GlobalShortcutPayload[] = [];
    for (const action of getGlobalShortcutActions()) {
        const combo = getKeyboardShortcutValue(action);
        if (!combo) continue;
        const accelerator = toElectronAccelerator(combo);
        if (!accelerator) continue;
        payload.push({ action, accelerator });
    }
    return payload;
};

let started = false;

/**
 * Wire up the bridge. Safe to call multiple times; subsequent calls are no-ops.
 * Called from the vector app entry once SettingsStore is ready.
 */
export const startGlobalShortcutsBridge = (): void => {
    if (started) return;
    const electron = getElectron();
    if (!electron) return;
    started = true;

    const sync = (): void => {
        electron.send("setGlobalShortcuts", computeGlobalsPayload());
    };

    // Send the initial set and re-sync whenever either setting changes.
    sync();
    SettingsStore.watchSetting("Keyboard.userShortcuts", null, sync);
    SettingsStore.watchSetting("Keyboard.globalShortcuts", null, sync);

    electron.on("globalShortcutFired", (_ev, action) => {
        if (typeof action !== "string") return;
        const combo = getKeyboardShortcutValue(action as KeyBindingAction);
        if (!combo) return;
        dispatchSyntheticKeyEvent(combo);
    });
};
