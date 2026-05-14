/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type KeyCombo } from "../KeyBindingsManager";
import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";
import { type KeyBindingAction, CATEGORIES } from "./KeyboardShortcuts";

export type KeyboardShortcutOverrides = Partial<Record<KeyBindingAction, KeyCombo>>;

const SETTING_NAME = "Keyboard.userShortcuts";

/** Modifier-only keys that should never form a binding on their own. */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);

export const getUserShortcutOverrides = (): KeyboardShortcutOverrides => {
    return SettingsStore.getValue(SETTING_NAME) ?? {};
};

export const setUserShortcutOverride = async (action: KeyBindingAction, combo: KeyCombo): Promise<void> => {
    const next: KeyboardShortcutOverrides = { ...getUserShortcutOverrides(), [action]: combo };
    await SettingsStore.setValue(SETTING_NAME, null, SettingLevel.DEVICE, next);
};

export const clearUserShortcutOverride = async (action: KeyBindingAction): Promise<void> => {
    const next: KeyboardShortcutOverrides = { ...getUserShortcutOverrides() };
    delete next[action];
    await SettingsStore.setValue(SETTING_NAME, null, SettingLevel.DEVICE, next);
};

export const clearAllUserShortcutOverrides = async (): Promise<void> => {
    await SettingsStore.setValue(SETTING_NAME, null, SettingLevel.DEVICE, {});
};

/**
 * Capture a KeyCombo from a keydown event. Returns null when only modifier
 * keys are pressed, so callers can keep listening until a "real" key arrives.
 */
export const captureCombo = (ev: KeyboardEvent | React.KeyboardEvent): KeyCombo | null => {
    if (MODIFIER_KEYS.has(ev.key)) return null;

    const combo: KeyCombo = { key: ev.key };
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
        !!a.ctrlOrCmdKey === !!b.ctrlOrCmdKey
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
