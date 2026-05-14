/*
Copyright 2026 Oss Al-Alali

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    captureCombo,
    comboCanBeGlobal,
    combosEqual,
    findConflicts,
    toElectronAccelerator,
} from "../../../src/accessibility/KeyboardShortcutsCustomization";
import { KeyBindingAction } from "../../../src/accessibility/KeyboardShortcuts";
import { type KeyCombo } from "../../../src/KeyBindingsManager";

const makeEvent = (
    key: string,
    mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {},
): KeyboardEvent =>
    ({
        key,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...mods,
    }) as KeyboardEvent;

describe("KeyboardShortcutsCustomization", () => {
    describe("captureCombo", () => {
        it("returns null for modifier-only presses so callers keep listening", () => {
            expect(captureCombo(makeEvent("Control"))).toBeNull();
            expect(captureCombo(makeEvent("Shift"))).toBeNull();
            expect(captureCombo(makeEvent("Alt"))).toBeNull();
            expect(captureCombo(makeEvent("Meta"))).toBeNull();
        });

        it("captures plain letter presses", () => {
            expect(captureCombo(makeEvent("a"))).toEqual({ key: "a" });
        });

        it("captures combo with modifiers", () => {
            expect(captureCombo(makeEvent("b", { ctrlKey: true, shiftKey: true }))).toEqual({
                key: "b",
                ctrlKey: true,
                shiftKey: true,
            });
        });

        it("omits modifier flags that are not pressed (rather than setting them to false)", () => {
            // Keeping the combo shape sparse helps it serialise cleanly into the SettingsStore.
            const combo = captureCombo(makeEvent("k", { ctrlKey: true }))!;
            expect(combo).toEqual({ key: "k", ctrlKey: true });
            expect("altKey" in combo).toBe(false);
            expect("shiftKey" in combo).toBe(false);
            expect("metaKey" in combo).toBe(false);
        });
    });

    describe("combosEqual", () => {
        it("treats undefined and false as the same modifier state", () => {
            expect(combosEqual({ key: "a" }, { key: "a", ctrlKey: false })).toBe(true);
        });

        it("returns false when keys differ", () => {
            expect(combosEqual({ key: "a" }, { key: "b" })).toBe(false);
        });

        it("returns false when one combo has a modifier and the other does not", () => {
            expect(combosEqual({ key: "a", ctrlKey: true }, { key: "a" })).toBe(false);
        });

        it("distinguishes ctrlKey from ctrlOrCmdKey", () => {
            expect(
                combosEqual({ key: "a", ctrlKey: true }, { key: "a", ctrlOrCmdKey: true }),
            ).toBe(false);
        });
    });

    describe("findConflicts", () => {
        const composerCombo: KeyCombo = { key: "b", ctrlKey: true };

        it("returns an empty list when no other action in the category shares the combo", () => {
            const siblings: Partial<Record<KeyBindingAction, KeyCombo>> = {
                [KeyBindingAction.FormatBold]: composerCombo,
                [KeyBindingAction.FormatItalics]: { key: "i", ctrlKey: true },
            };
            expect(findConflicts(KeyBindingAction.FormatBold, composerCombo, siblings)).toEqual([]);
        });

        it("returns the conflicting actions in the same category", () => {
            const siblings: Partial<Record<KeyBindingAction, KeyCombo>> = {
                [KeyBindingAction.FormatBold]: composerCombo,
                [KeyBindingAction.FormatItalics]: composerCombo,
            };
            expect(findConflicts(KeyBindingAction.FormatBold, composerCombo, siblings)).toEqual([
                KeyBindingAction.FormatItalics,
            ]);
        });

        it("does not report cross-category overlaps", () => {
            // ToggleWebcamInCall lives in CALLS, FormatCode lives in COMPOSER.
            // Both default to Ctrl+E and that's intentional — they're context-scoped.
            const callsCombo: KeyCombo = { key: "e", ctrlKey: true };
            const siblings: Partial<Record<KeyBindingAction, KeyCombo>> = {
                [KeyBindingAction.FormatCode]: callsCombo,
                [KeyBindingAction.ToggleWebcamInCall]: callsCombo,
            };
            expect(findConflicts(KeyBindingAction.FormatCode, callsCombo, siblings)).toEqual([]);
        });
    });

    describe("comboCanBeGlobal", () => {
        // We refuse to globally register combos that would steal everyday typing keys.
        it.each([
            [{ key: "a" }, false],
            [{ key: "a", shiftKey: true }, false],
            [{ key: "Enter" }, false],
        ])("returns false for plain/Shift-only combos (%j)", (combo, expected) => {
            expect(comboCanBeGlobal(combo)).toBe(expected);
        });

        it.each([
            [{ key: "m", ctrlKey: true, shiftKey: true }],
            [{ key: "d", altKey: true }],
            [{ key: "k", ctrlOrCmdKey: true }],
            [{ key: "p", metaKey: true }],
        ])("returns true once a non-Shift modifier is present (%j)", (combo) => {
            expect(comboCanBeGlobal(combo)).toBe(true);
        });

        it("treats F13-F24 as globally safe even without a modifier", () => {
            expect(comboCanBeGlobal({ key: "F13" })).toBe(true);
            expect(comboCanBeGlobal({ key: "F24" })).toBe(true);
            // F12 is not in the safe range — it's commonly bound by browsers and OS.
            expect(comboCanBeGlobal({ key: "F12" })).toBe(false);
        });
    });

    describe("toElectronAccelerator", () => {
        it("returns null for combos that can't be safely globalised", () => {
            expect(toElectronAccelerator({ key: "a" })).toBeNull();
        });

        it("uppercases single letters and joins modifiers with +", () => {
            expect(toElectronAccelerator({ key: "m", ctrlKey: true, shiftKey: true })).toBe(
                "Control+Shift+M",
            );
        });

        it("uses CommandOrControl for ctrlOrCmdKey combos", () => {
            expect(toElectronAccelerator({ key: "k", ctrlOrCmdKey: true })).toBe("CommandOrControl+K");
        });

        it("passes function keys through unchanged", () => {
            expect(toElectronAccelerator({ key: "F13" })).toBe("F13");
        });
    });
});
