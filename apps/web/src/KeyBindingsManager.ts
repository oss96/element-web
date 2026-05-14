/*
Copyright 2024 New Vector Ltd.
Copyright 2022 Šimon Brandner <simon.bra.ag@gmail.com>
Copyright 2021 Clemens Zeidler

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type KeyBindingAction } from "./accessibility/KeyboardShortcuts";
import { defaultBindingsProvider } from "./KeyBindingsDefaults";
import { IS_MAC } from "./Keyboard";

/**
 * Map a `KeyboardEvent.code` value to the un-shifted character of that physical key, so
 * captures and matches stay stable across Shift modifications (Shift+1 → "1", not "!").
 * For codes outside the standard digit / letter / punctuation set, the caller's `ev.key` fallback is used.
 */
const CODE_TO_UNSHIFTED: Record<string, string> = {
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Backslash: "\\",
    IntlBackslash: "\\",
    Comma: ",",
    Period: ".",
    Slash: "/",
    NumpadAdd: "+",
    NumpadSubtract: "-",
    NumpadMultiply: "*",
    NumpadDivide: "/",
    NumpadDecimal: ".",
    NumpadEqual: "=",
    NumpadEnter: "Enter",
};

export const unshiftedFromCode = (code: string | undefined, fallback: string): string => {
    if (!code) return fallback;
    if (code in CODE_TO_UNSHIFTED) return CODE_TO_UNSHIFTED[code];
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad") && /^[0-9]$/.test(code.slice(6))) return code.slice(6);
    // Letters are stored lower-case so they line up with the existing KEYBOARD_SHORTCUTS defaults
    // (e.g. Key.B === "b"); the display layer uppercases for the kbd glyph.
    if (code.startsWith("Key")) return code.slice(3).toLowerCase();
    return fallback;
};

/**
 * Represent a key combination.
 *
 * The combo is evaluated strictly, i.e. the KeyboardEvent must match exactly what is specified in the KeyCombo.
 */
export type KeyCombo = {
    key: string;

    /**
     * True when the binding was recorded on the numeric keypad. The match against an incoming
     * KeyboardEvent only considers this flag when it's `true` — combos without it stay
     * backwards-compatible with the existing defaults that fire on either physical row.
     */
    numpad?: boolean;

    /** On PC: ctrl is pressed; on Mac: meta is pressed */
    ctrlOrCmdKey?: boolean;

    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
};

export type KeyBinding = {
    action: KeyBindingAction;
    keyCombo: KeyCombo;
};

/**
 * Helper method to check if a KeyboardEvent matches a KeyCombo
 *
 * Note, this method is only exported for testing.
 */
export function isKeyComboMatch(ev: KeyboardEvent | React.KeyboardEvent, combo: KeyCombo, onMac: boolean): boolean {
    // An empty `key` is the "cleared" sentinel: the user has explicitly unbound this
    // shortcut, so no real keypress should ever fire it.
    if (combo.key === "") return false;
    if (combo.key !== undefined) {
        // A numpad-flagged binding only fires when the physical numpad press it was recorded
        // from is what came in. Conversely, an unflagged combo still matches both numpad and
        // main-row presses, so defaults like ScrollUp on PageUp keep working from either key.
        if (combo.numpad && !(typeof ev.code === "string" && ev.code.startsWith("Numpad"))) {
            return false;
        }

        // When shift is pressed, letters are returned as upper case chars. In this case do a lower case comparison.
        // This works for letter combos such as shift + U as well for none letter combos such as shift + Escape.
        // If shift is not pressed, the toLowerCase conversion can be avoided.
        //
        // We also accept a match against the un-shifted physical key (derived from ev.code below),
        // so Ctrl+Shift+1 recorded as `{key: "1", shiftKey: true}` still fires when the user
        // produces "!" by holding shift over the digit row.
        const physical = unshiftedFromCode(ev.code, ev.key);
        if (ev.shiftKey) {
            const evLower = ev.key.toLowerCase();
            const physLower = physical.toLowerCase();
            const comboLower = combo.key.toLowerCase();
            if (evLower !== comboLower && physLower !== comboLower) {
                return false;
            }
        } else if (ev.key !== combo.key && physical !== combo.key) {
            return false;
        }
    }

    const comboCtrl = combo.ctrlKey ?? false;
    const comboAlt = combo.altKey ?? false;
    const comboShift = combo.shiftKey ?? false;
    const comboMeta = combo.metaKey ?? false;
    // Tests mock events may keep the modifiers undefined; convert them to booleans
    const evCtrl = ev.ctrlKey ?? false;
    const evAlt = ev.altKey ?? false;
    const evShift = ev.shiftKey ?? false;
    const evMeta = ev.metaKey ?? false;
    // When ctrlOrCmd is set, the keys need do evaluated differently on PC and Mac
    if (combo.ctrlOrCmdKey) {
        if (onMac) {
            if (!evMeta || evCtrl !== comboCtrl || evAlt !== comboAlt || evShift !== comboShift) {
                return false;
            }
        } else {
            if (!evCtrl || evMeta !== comboMeta || evAlt !== comboAlt || evShift !== comboShift) {
                return false;
            }
        }
        return true;
    }

    if (evMeta !== comboMeta || evCtrl !== comboCtrl || evAlt !== comboAlt || evShift !== comboShift) {
        return false;
    }

    return true;
}

export type KeyBindingGetter = () => KeyBinding[];

export interface IKeyBindingsProvider {
    [key: string]: KeyBindingGetter;
}

export class KeyBindingsManager {
    /**
     * List of key bindings providers.
     *
     * Key bindings from the first provider(s) in the list will have precedence over key bindings from later providers.
     *
     * To overwrite the default key bindings add a new providers before the default provider, e.g. a provider for
     * customized key bindings.
     */
    public bindingsProviders: IKeyBindingsProvider[] = [defaultBindingsProvider];

    /**
     * Finds a matching KeyAction for a given KeyboardEvent
     */
    private getAction(
        getters: KeyBindingGetter[],
        ev: KeyboardEvent | React.KeyboardEvent,
    ): KeyBindingAction | undefined {
        for (const getter of getters) {
            const bindings = getter();
            const binding = bindings.find((it) => isKeyComboMatch(ev, it.keyCombo, IS_MAC));
            if (binding) {
                return binding.action;
            }
        }
        return undefined;
    }

    public getMessageComposerAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getMessageComposerBindings),
            ev,
        );
    }

    public getAutocompleteAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getAutocompleteBindings),
            ev,
        );
    }

    public getRoomListAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getRoomListBindings),
            ev,
        );
    }

    public getRoomAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getRoomBindings),
            ev,
        );
    }

    public getNavigationAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getNavigationBindings),
            ev,
        );
    }

    public getAccessibilityAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getAccessibilityBindings),
            ev,
        );
    }

    public getCallAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getCallBindings),
            ev,
        );
    }

    public getLabsAction(ev: KeyboardEvent | React.KeyboardEvent): KeyBindingAction | undefined {
        return this.getAction(
            this.bindingsProviders.map((it) => it.getLabsBindings),
            ev,
        );
    }
}

const manager = new KeyBindingsManager();

export function getKeyBindingsManager(): KeyBindingsManager {
    return manager;
}
