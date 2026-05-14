/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useState } from "react";

import { type KeyCombo } from "../../../KeyBindingsManager";
import { _t } from "../../../languageHandler";
import { type KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import {
    captureCombo,
    clearUserShortcutOverride,
    comboCanBeGlobal,
    findConflicts,
    setShortcutGlobal,
    setUserShortcutOverride,
} from "../../../accessibility/KeyboardShortcutsCustomization";
import { getKeyboardShortcutDisplayName } from "../../../accessibility/KeyboardShortcutUtils";
import AccessibleButton from "../elements/AccessibleButton";
import { KeyboardShortcut } from "./KeyboardShortcut";

interface IProps {
    action: KeyBindingAction;
    /** The currently effective combo (default merged with any user override). */
    combo: KeyCombo;
    /** True when the user has set an override for this action. Controls reset visibility. */
    isOverridden: boolean;
    /** True when this shortcut is currently flagged for OS-level global registration. */
    isGlobal: boolean;
    /** True when the action is allowed to be made global (desktop build + per-action allow-list). */
    globalEligible: boolean;
    /** Resolved combos for every editable action in the same category. Used for conflict detection. */
    siblingCombos: Partial<Record<KeyBindingAction, KeyCombo>>;
    /** Translated display label rendered by the parent. */
    displayName: string;
    /** Called after any persistent change so the parent re-renders with fresh data. */
    onChange: () => void;
}

export const KeyboardShortcutEditor: React.FC<IProps> = ({
    action,
    combo,
    isOverridden,
    isGlobal,
    globalEligible,
    siblingCombos,
    displayName,
    onChange,
}): JSX.Element => {
    const [recording, setRecording] = useState(false);

    // We listen on document at the capture phase rather than on the recorder element.
    // AccessibleButton's wrapping onKeyDown matches against the accessibility binding set
    // and can hijack Enter/Space and other action keys; pressing modifier keys also tends
    // to lose focus on the wrapped div. A document-level listener sidesteps both issues
    // and catches Shift+Numpad and multi-modifier presses reliably on Windows.
    useEffect(() => {
        if (!recording) return;

        const handler = (ev: KeyboardEvent): void => {
            ev.preventDefault();
            ev.stopPropagation();

            if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
                setRecording(false);
                return;
            }

            const next = captureCombo(ev);
            if (!next) return; // Modifier-only — keep listening for the real key.

            void (async () => {
                await setUserShortcutOverride(action, next);
                if (isGlobal && !comboCanBeGlobal(next)) {
                    await setShortcutGlobal(action, false);
                }
                setRecording(false);
                onChange();
            })();
        };

        document.addEventListener("keydown", handler, true);
        return () => document.removeEventListener("keydown", handler, true);
    }, [recording, action, isGlobal, onChange]);

    const handleReset = useCallback(async (): Promise<void> => {
        await clearUserShortcutOverride(action);
        onChange();
    }, [action, onChange]);

    const handleGlobalToggle = useCallback(async (): Promise<void> => {
        await setShortcutGlobal(action, !isGlobal);
        onChange();
    }, [action, isGlobal, onChange]);

    const conflicts = !recording ? findConflicts(action, combo, siblingCombos) : [];
    const canGlobalise = globalEligible && comboCanBeGlobal(combo);

    return (
        <li className="mx_KeyboardShortcut_shortcutRow">
            <span className="mx_KeyboardShortcut_shortcutLabel">{displayName}</span>
            <div className="mx_KeyboardShortcut_shortcutControls">
                {recording ? (
                    <div
                        className="mx_KeyboardShortcut_recording"
                        role="status"
                        aria-live="polite"
                        aria-label={_t("settings|keyboard|press_key_combination")}
                        onClick={() => setRecording(false)}
                    >
                        {_t("settings|keyboard|press_key_combination")}
                    </div>
                ) : (
                    <AccessibleButton
                        kind="link_inline"
                        className="mx_KeyboardShortcut_editTrigger"
                        onClick={() => setRecording(true)}
                        title={_t("settings|keyboard|click_to_rebind")}
                        aria-label={_t("settings|keyboard|click_to_rebind")}
                    >
                        <KeyboardShortcut value={combo} />
                    </AccessibleButton>
                )}
                {globalEligible && !recording && (
                    <AccessibleButton
                        kind="link_inline"
                        className="mx_KeyboardShortcut_globalToggle"
                        data-active={isGlobal}
                        disabled={!canGlobalise && !isGlobal}
                        onClick={canGlobalise || isGlobal ? handleGlobalToggle : null}
                        title={
                            canGlobalise || isGlobal
                                ? _t("settings|keyboard|global_toggle_hint")
                                : _t("settings|keyboard|global_requires_modifier")
                        }
                        aria-pressed={isGlobal}
                    >
                        {isGlobal ? _t("settings|keyboard|global_on") : _t("settings|keyboard|global_off")}
                    </AccessibleButton>
                )}
                {isOverridden && !recording && (
                    <AccessibleButton
                        kind="icon"
                        className="mx_KeyboardShortcut_resetButton"
                        onClick={handleReset}
                        title={_t("settings|keyboard|reset_to_default")}
                        aria-label={_t("settings|keyboard|reset_to_default")}
                    >
                        ↺
                    </AccessibleButton>
                )}
            </div>
            {conflicts.length > 0 && (
                <span className="mx_KeyboardShortcut_conflict" role="alert">
                    {_t("settings|keyboard|conflict_warning", {
                        actions: conflicts
                            .map((c) => getKeyboardShortcutDisplayName(c) ?? c)
                            .join(", "),
                    })}
                </span>
            )}
        </li>
    );
};
