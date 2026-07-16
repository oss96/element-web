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
    isComboCleared,
    toElectronAccelerator,
} from "../../../src/accessibility/KeyboardShortcutsCustomization";
import { KeyBindingAction } from "../../../src/accessibility/KeyboardShortcuts";
import { type KeyCombo } from "../../../src/KeyBindingsManager";

const makeEvent = (
    key: string,
    mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code">> = {},
): KeyboardEvent =>
    ({
        key,
        code: "",
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

        it("derives the un-shifted character from event.code for shifted digits", () => {
            // Browser delivers "!" when Shift+1 is pressed on a US layout. The recorded
            // combo should still read "1" so the row and the global accelerator both make sense.
            const combo = captureCombo(makeEvent("!", { code: "Digit1", ctrlKey: true, shiftKey: true }));
            expect(combo).toEqual({ key: "1", ctrlKey: true, shiftKey: true });
        });

        it("flags numpad presses and records the digit even when NumLock is off", () => {
            // Numpad 7 with NumLock off arrives as ev.key="Home". We still record "7" + numpad.
            const numLockOff = captureCombo(makeEvent("Home", { code: "Numpad7", ctrlKey: true }));
            expect(numLockOff).toEqual({ key: "7", numpad: true, ctrlKey: true });

            const numLockOn = captureCombo(makeEvent("7", { code: "Numpad7", ctrlKey: true }));
            expect(numLockOn).toEqual({ key: "7", numpad: true, ctrlKey: true });
        });

        it("derives KeyA-style codes back to their letter", () => {
            // Caps Lock would change ev.key to "A"; the binding still wants "a".
            const combo = captureCombo(makeEvent("A", { code: "KeyA", ctrlKey: true }));
            expect(combo!.key).toBe("a");
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

        it("emits Electron's numX alias for numpad digit combos", () => {
            expect(toElectronAccelerator({ key: "0", numpad: true, ctrlKey: true })).toBe("Control+num0");
            expect(toElectronAccelerator({ key: "7", numpad: true, ctrlOrCmdKey: true })).toBe(
                "CommandOrControl+num7",
            );
        });

        it("emits the matching alias for numpad operators (numadd/numsub/etc.)", () => {
            expect(toElectronAccelerator({ key: "+", numpad: true, ctrlKey: true })).toBe("Control+numadd");
            expect(toElectronAccelerator({ key: "*", numpad: true, ctrlKey: true })).toBe("Control+nummult");
        });
    });

    describe("cleared sentinel", () => {
        it("isComboCleared treats an empty key as cleared", () => {
            expect(isComboCleared({ key: "" })).toBe(true);
            // Modifiers without a real key don't count as a real binding either.
            expect(isComboCleared({ key: "", ctrlKey: true })).toBe(true);
        });

        it("isComboCleared returns false for a real combo", () => {
            expect(isComboCleared({ key: "a" })).toBe(false);
            expect(isComboCleared({ key: "F13" })).toBe(false);
            expect(isComboCleared(undefined)).toBe(false);
        });

        it("comboCanBeGlobal refuses a cleared combo even if it has modifiers", () => {
            // A cleared combo with stray modifier flags would otherwise serialise to a malformed
            // accelerator like "Control+" — comboCanBeGlobal must veto it before we get there.
            expect(comboCanBeGlobal({ key: "" })).toBe(false);
            expect(comboCanBeGlobal({ key: "", ctrlKey: true })).toBe(false);
        });
    });
});
