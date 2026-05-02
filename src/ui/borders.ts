// Hoisted BorderCharacters constants. @opentui/react's host
// reconciler compares props by reference (`newProp !== oldProp`), so
// an inline `customBorderChars={{…}}` re-sets the renderable's border
// config and calls `requestRender()` on every parent reconcile even
// when nothing changed. Module-level objects fix the identity.

import type { BorderCharacters } from "@opentui/core"

/** Left-edge heavy bar only — panel/card accent. */
export const LEFT_BAR: BorderCharacters = {
  topLeft: "", bottomLeft: "", topRight: "", bottomRight: "",
  horizontal: "", vertical: "┃",
  topT: "", bottomT: "", leftT: "", rightT: "", cross: "",
}

/** Light single vertical on both sides, no horizontals. */
export const SIDE_PIPE: BorderCharacters = {
  topLeft: "│", bottomLeft: "│", vertical: "│",
  topRight: "│", bottomRight: "│", horizontal: "",
  topT: "", bottomT: "", leftT: "", rightT: "", cross: "",
}

/** Corners only — the Context heat-grid frame. */
export const CORNERS: BorderCharacters = {
  topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘",
  horizontal: " ", vertical: " ",
  topT: " ", bottomT: " ", leftT: " ", rightT: " ", cross: " ",
}
