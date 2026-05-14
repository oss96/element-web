/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";

import { type KeyCombo } from "../../../KeyBindingsManager";
import { _t } from "../../../languageHandler";
import { type KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import {
    captureCombo,
    clearUserShortcutOverride,
    findConflicts,
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
    siblingCombos,
    displayName,
    onChange,
}): JSX.Element => {
    const [recording, setRecording] = useState(false);
    const recorderRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (recording) recorderRef.current?.focus();
    }, [recording]);

    const handleKeyDown = useCallback(
        async (ev: React.KeyboardEvent<HTMLDivElement>): Promise<void> => {
            ev.preventDefault();
            ev.stopPropagation();

            // Plain Escape cancels recording without saving.
            if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
                setRecording(false);
                return;
            }

            const next = captureCombo(ev);
            if (!next) return; // Modifier-only — keep listening.

            await setUserShortcutOverride(action, next);
            setRecording(false);
            onChange();
        },
        [action, onChange],
    );

    const handleReset = useCallback(async (): Promise<void> => {
        await clearUserShortcutOverride(action);
        onChange();
    }, [action, onChange]);

    const conflicts = !recording ? findConflicts(action, combo, siblingCombos) : [];

    return (
        <li className="mx_KeyboardShortcut_shortcutRow">
            <span className="mx_KeyboardShortcut_shortcutLabel">{displayName}</span>
            <div className="mx_KeyboardShortcut_shortcutControls">
                {recording ? (
                    <AccessibleButton
                        element="div"
                        kind="secondary"
                        className="mx_KeyboardShortcut_recording"
                        onClick={() => setRecording(false)}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={recorderRef}
                        aria-label={_t("settings|keyboard|press_key_combination")}
                    >
                        {_t("settings|keyboard|press_key_combination")}
                    </AccessibleButton>
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
