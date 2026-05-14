/*
Copyright 2024 New Vector Ltd.
Copyright 2021, 2022 Šimon Brandner <simon.bra.ag@gmail.com>
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useCallback, useState } from "react";

import {
    type ICategory,
    CATEGORIES,
    CategoryName,
    type KeyBindingAction,
} from "../../../../../accessibility/KeyboardShortcuts";
import { type KeyCombo } from "../../../../../KeyBindingsManager";
import { _t } from "../../../../../languageHandler";
import {
    getKeyboardShortcutDisplayName,
    getKeyboardShortcutValue,
    getKeyboardShortcuts,
} from "../../../../../accessibility/KeyboardShortcutUtils";
import {
    clearAllUserShortcutOverrides,
    getUserShortcutOverrides,
} from "../../../../../accessibility/KeyboardShortcutsCustomization";
import { KeyboardShortcut } from "../../KeyboardShortcut";
import { KeyboardShortcutEditor } from "../../KeyboardShortcutEditor";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import AccessibleButton from "../../../elements/AccessibleButton";
import { showLabsFlags } from "./LabsUserSettingsTab";

// Filter out the labs section if labs aren't enabled.
const visibleCategories = (Object.entries(CATEGORIES) as [CategoryName, ICategory][]).filter(
    ([categoryName]) => categoryName !== CategoryName.LABS || showLabsFlags(),
);

interface IKeyboardShortcutRowProps {
    name: KeyBindingAction;
    /** Editable rows must receive the resolved combos of their siblings for conflict detection. */
    siblingCombos?: Partial<Record<KeyBindingAction, KeyCombo>>;
    /** When the action is in the editable set, providing onChange enables click-to-rebind. */
    onChange?: () => void;
    /** Pre-computed set of editable actions. A row is editable iff its action is in this set. */
    editableActions: Set<KeyBindingAction>;
    /** Actions that currently have a user-set override. */
    overriddenActions: Set<KeyBindingAction>;
}

const KeyboardShortcutRow: React.FC<IKeyboardShortcutRowProps> = ({
    name,
    siblingCombos,
    onChange,
    editableActions,
    overriddenActions,
}) => {
    const displayName = getKeyboardShortcutDisplayName(name);
    const value = getKeyboardShortcutValue(name);
    if (!displayName || !value) return null;

    if (editableActions.has(name) && onChange && siblingCombos) {
        return (
            <KeyboardShortcutEditor
                action={name}
                combo={value}
                displayName={displayName}
                isOverridden={overriddenActions.has(name)}
                siblingCombos={siblingCombos}
                onChange={onChange}
            />
        );
    }

    return (
        <li className="mx_KeyboardShortcut_shortcutRow">
            {displayName}
            <KeyboardShortcut value={value} />
        </li>
    );
};

interface IKeyboardShortcutSectionProps {
    categoryName: CategoryName;
    category: ICategory;
    editableActions: Set<KeyBindingAction>;
    overriddenActions: Set<KeyBindingAction>;
    onChange: () => void;
}

const KeyboardShortcutSection: React.FC<IKeyboardShortcutSectionProps> = ({
    categoryName,
    category,
    editableActions,
    overriddenActions,
    onChange,
}) => {
    if (!category.categoryLabel) return null;

    // Resolved combos for every editable action in this section — needed for in-section conflict warnings.
    const siblingCombos: Partial<Record<KeyBindingAction, KeyCombo>> = {};
    for (const action of category.settingNames) {
        if (!editableActions.has(action)) continue;
        const combo = getKeyboardShortcutValue(action);
        if (combo) siblingCombos[action] = combo;
    }

    return (
        <SettingsSubsection heading={_t(category.categoryLabel)} key={categoryName}>
            <ul className="mx_KeyboardShortcut_shortcutList">
                {category.settingNames.map((shortcutName) => (
                    <KeyboardShortcutRow
                        key={shortcutName}
                        name={shortcutName}
                        editableActions={editableActions}
                        overriddenActions={overriddenActions}
                        siblingCombos={siblingCombos}
                        onChange={onChange}
                    />
                ))}
            </ul>
        </SettingsSubsection>
    );
};

const KeyboardUserSettingsTab: React.FC = () => {
    // Re-render trigger: bumped after any persistent override change.
    const [, setRevision] = useState(0);
    const onChange = useCallback(() => setRevision((r) => r + 1), []);

    // Editable actions: those defined in KEYBOARD_SHORTCUTS and not in the UI-only set.
    // getKeyboardShortcuts() already excludes UI-only entries (which getKeyboardShortcutsForUI adds back).
    // Recomputed each render so it picks up override changes triggered via setRevision.
    const editableActions = new Set(Object.keys(getKeyboardShortcuts()) as KeyBindingAction[]);
    const overriddenActions = new Set(Object.keys(getUserShortcutOverrides()) as KeyBindingAction[]);

    const hasAnyOverride = overriddenActions.size > 0;

    const handleResetAll = useCallback(async () => {
        await clearAllUserShortcutOverrides();
        onChange();
    }, [onChange]);

    return (
        <SettingsTab>
            <SettingsSection>
                {hasAnyOverride && (
                    <div className="mx_KeyboardShortcut_resetAllRow">
                        <AccessibleButton kind="link_inline" onClick={handleResetAll}>
                            {_t("settings|keyboard|reset_all")}
                        </AccessibleButton>
                    </div>
                )}
                {visibleCategories.map(([categoryName, category]) => (
                    <KeyboardShortcutSection
                        key={categoryName}
                        categoryName={categoryName}
                        category={category}
                        editableActions={editableActions}
                        overriddenActions={overriddenActions}
                        onChange={onChange}
                    />
                ))}
            </SettingsSection>
        </SettingsTab>
    );
};

export default KeyboardUserSettingsTab;
