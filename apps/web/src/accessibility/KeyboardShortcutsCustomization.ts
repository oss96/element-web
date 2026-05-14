/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type KeyCombo, unshiftedFromCode } from "../KeyBindingsManager";
import { IS_MAC } from "../Keyboard";
import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";
import { type KeyBindingAction, CATEGORIES } from "./KeyboardShortcuts";

export type KeyboardShortcutOverrides = Partial<Record<KeyBindingAction, KeyCombo>>;

const OVERRIDES_SETTING = "Keyboard.userShortcuts";
const GLOBALS_SETTING = "Keyboard.globalShortcuts";

/** Modifier-only keys that should never form a binding on their own. */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);

/** Function keys that are safe to register globally without a modifier (rarely conflict). */
const SAFE_FUNCTION_KEYS = new Set([
    "F13",
    "F14",
    "F15",
    "F16",
    "F17",
    "F18",
    "F19",
    "F20",
    "F21",
    "F22",
    "F23",
    "F24",
]);

export const getUserShortcutOverrides = (): KeyboardShortcutOverrides => {
    return SettingsStore.getValue(OVERRIDES_SETTING) ?? {};
};

export const setUserShortcutOverride = async (action: KeyBindingAction, combo: KeyCombo): Promise<void> => {
    const next: KeyboardShortcutOverrides = { ...getUserShortcutOverrides(), [action]: combo };
    await SettingsStore.setValue(OVERRIDES_SETTING, null, SettingLevel.DEVICE, next);
};

export const clearUserShortcutOverride = async (action: KeyBindingAction): Promise<void> => {
    const next: KeyboardShortcutOverrides = { ...getUserShortcutOverrides() };
    delete next[action];
    await SettingsStore.setValue(OVERRIDES_SETTING, null, SettingLevel.DEVICE, next);
    // A cleared override also drops the global registration for the same action.
    await setShortcutGlobal(action, false);
};

export const clearAllUserShortcutOverrides = async (): Promise<void> => {
    await SettingsStore.setValue(OVERRIDES_SETTING, null, SettingLevel.DEVICE, {});
    await SettingsStore.setValue(GLOBALS_SETTING, null, SettingLevel.DEVICE, []);
};

/** Actions the user has flagged for OS-level global registration (desktop only). */
export const getGlobalShortcutActions = (): KeyBindingAction[] => {
    return (SettingsStore.getValue(GLOBALS_SETTING) ?? []) as KeyBindingAction[];
};

export const isShortcutGlobal = (action: KeyBindingAction): boolean => {
    return getGlobalShortcutActions().includes(action);
};

export const setShortcutGlobal = async (action: KeyBindingAction, enabled: boolean): Promise<void> => {
    const current = getGlobalShortcutActions();
    const isCurrentlyOn = current.includes(action);
    if (enabled === isCurrentlyOn) return;
    const next = enabled ? [...current, action] : current.filter((a) => a !== action);
    await SettingsStore.setValue(GLOBALS_SETTING, null, SettingLevel.DEVICE, next);
};

/**
 * A combo can be safely registered as a global hotkey when it includes at least one
 * non-Shift modifier or is a safe function key. Plain letters/digits/Shift+letter would
 * otherwise be hijacked from every other app on the machine.
 */
export const comboCanBeGlobal = (combo: KeyCombo): boolean => {
    if (SAFE_FUNCTION_KEYS.has(combo.key)) return true;
    return !!(combo.ctrlKey || combo.altKey || combo.metaKey || combo.ctrlOrCmdKey);
};

/**
 * Convert a KeyCombo to Electron's accelerator string format. Returns null when the
 * combo cannot be safely globalised (caller should skip registration).
 */
export const toElectronAccelerator = (combo: KeyCombo): string | null => {
    if (!comboCanBeGlobal(combo)) return null;

    const parts: string[] = [];
    if (combo.ctrlOrCmdKey) parts.push("CommandOrControl");
    else {
        if (combo.ctrlKey) parts.push("Control");
        if (combo.metaKey) parts.push(IS_MAC ? "Command" : "Super");
    }
    if (combo.altKey) parts.push("Alt");
    if (combo.shiftKey) parts.push("Shift");

    parts.push(toAcceleratorKey(combo));

    return parts.join("+");
};

/**
 * Map a combo's key to Electron's accelerator key name. Letters get uppercased; numpad
 * digits and operators use Electron's `num*` aliases so they bind to the keypad
 * specifically rather than the digit row.
 */
const NUMPAD_ACCELERATOR: Record<string, string> = {
    "+": "numadd",
    "-": "numsub",
    "*": "nummult",
    "/": "numdiv",
    ".": "numdec",
};

const toAcceleratorKey = (combo: KeyCombo): string => {
    if (combo.numpad) {
        if (/^[0-9]$/.test(combo.key)) return "num" + combo.key;
        if (NUMPAD_ACCELERATOR[combo.key]) return NUMPAD_ACCELERATOR[combo.key];
    }
    if (/^[a-z]$/i.test(combo.key)) return combo.key.toUpperCase();
    return combo.key;
};

/**
 * Capture a KeyCombo from a keydown event. Returns null when only modifier
 * keys are pressed, so callers can keep listening until a "real" key arrives.
 *
 * The captured `key` is the un-shifted character of the physical key (so Shift+1
 * records as "1", not "!", and so Numpad 7 records as "7" with `numpad: true`
 * instead of "Home" when NumLock is off). This keeps recorded combos stable across
 * Shift state and lets the global hotkey registrar tell the numpad apart from the
 * digit row.
 */
export const captureCombo = (ev: KeyboardEvent | React.KeyboardEvent): KeyCombo | null => {
    if (MODIFIER_KEYS.has(ev.key)) return null;

    const code = typeof ev.code === "string" ? ev.code : "";
    const combo: KeyCombo = { key: unshiftedFromCode(code, ev.key) };
    if (code.startsWith("Numpad")) combo.numpad = true;
    if (ev.ctrlKey) combo.ctrlKey = true;
    if (ev.altKey) combo.altKey = true;
    if (ev.shiftKey) combo.shiftKey = true;
    if (ev.metaKey) combo.metaKey = true;
    return combo;
};

/** Compare two combos for semantic equivalence (treats undefined and false the same). */
export const combosEqual = (a: KeyCombo, b: KeyCombo): boolean => {
    if (a.key !== b.key) return false;
    return (
        !!a.ctrlKey === !!b.ctrlKey &&
        !!a.altKey === !!b.altKey &&
        !!a.shiftKey === !!b.shiftKey &&
        !!a.metaKey === !!b.metaKey &&
        !!a.ctrlOrCmdKey === !!b.ctrlOrCmdKey &&
        !!a.numpad === !!b.numpad
    );
};

/**
 * Find other actions in the same category that share the same combo.
 * Used to surface conflict warnings in the settings UI.
 */
export const findConflicts = (
    action: KeyBindingAction,
    combo: KeyCombo,
    resolvedValues: Partial<Record<KeyBindingAction, KeyCombo>>,
): KeyBindingAction[] => {
    const conflicts: KeyBindingAction[] = [];
    for (const category of Object.values(CATEGORIES)) {
        if (!category.settingNames.includes(action)) continue;
        for (const other of category.settingNames) {
            if (other === action) continue;
            const otherCombo = resolvedValues[other];
            if (otherCombo && combosEqual(combo, otherCombo)) conflicts.push(other);
        }
    }
    return conflicts;
};

/**
 * Synthesise a Keyboard event matching a KeyCombo and dispatch it at document level.
 * Used by the global-hotkey bridge to fan an OS-level press out to whatever in-app
 * handler would normally process that combo (e.g. the call view's mic toggle).
 */
export const dispatchSyntheticKeyEvent = (combo: KeyCombo): void => {
    const ctrlOrCmd = combo.ctrlOrCmdKey;
    const ev = new KeyboardEvent("keydown", {
        key: combo.key,
        bubbles: true,
        cancelable: true,
        ctrlKey: !!combo.ctrlKey || (!!ctrlOrCmd && !IS_MAC),
        metaKey: !!combo.metaKey || (!!ctrlOrCmd && IS_MAC),
        altKey: !!combo.altKey,
        shiftKey: !!combo.shiftKey,
    });
    document.dispatchEvent(ev);
};
