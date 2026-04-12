/**
 * Theme resolver — takes a ThemeJson + mode, returns a fully resolved Theme.
 *
 * Handles: hex colors, defs references, cross-token references,
 * dark/light variants, ANSI codes, transparent/none, circular detection.
 */

import { RGBA } from "@opentui/core";
import type { Theme, ThemeJson, ThemeColor, ColorValue, HermTokens } from "./types";

/** Resolve a ThemeJson into a concrete Theme with all RGBA values */
export function resolveTheme(
  theme: ThemeJson,
  mode: "dark" | "light",
): Theme {
  const defs = theme.defs ?? {};

  function resolve(c: ColorValue, chain: string[] = []): RGBA {
    if (c instanceof RGBA) return c;

    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0);
      if (c.startsWith("#")) return RGBA.fromHex(c);

      // Reference — check for circular
      if (chain.includes(c)) {
        throw new Error(`Circular color reference: ${[...chain, c].join(" -> ")}`);
      }
      const next = defs[c] ?? theme.theme[c as ThemeColor];
      if (next === undefined) {
        throw new Error(`Color reference "${c}" not found in defs or theme`);
      }
      return resolve(next, [...chain, c]);
    }

    if (typeof c === "number") return ansiToRgba(c);

    // Variant — pick dark or light
    return resolve(c[mode], chain);
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(
        ([key]) =>
          key !== "selectedListItemText" &&
          key !== "backgroundMenu" &&
          key !== "thinkingOpacity",
      )
      .map(([key, value]) => [key, resolve(value as ColorValue)]),
  ) as Partial<Record<ThemeColor, RGBA>>;

  // Optional tokens with fallbacks
  const hasList = theme.theme.selectedListItemText !== undefined;
  resolved.selectedListItemText = hasList
    ? resolve(theme.theme.selectedListItemText!)
    : resolved.background;

  resolved.backgroundMenu =
    theme.theme.backgroundMenu !== undefined
      ? resolve(theme.theme.backgroundMenu)
      : resolved.backgroundElement;

  const base = {
    ...resolved,
    _hasSelectedListItemText: hasList,
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6,
  };

  // Compute herm-specific tokens
  const herm = resolveHermTokens(base as any);

  return { ...base, ...herm } as Theme;
}

/**
 * Compute herm pillar tokens.
 * hermAvatar and hermBody default to accent.
 * hermBodyText is auto-computed for legibility against hermBody.
 */
function resolveHermTokens(theme: { accent: RGBA }): HermTokens {
  const avatar = theme.accent;
  const body = theme.accent;
  return {
    hermAvatar: avatar,
    hermBody: body,
    hermBodyText: contrastText(body),
  };
}

/**
 * Pick black or white text for maximum legibility on a background.
 * Uses WCAG relative luminance formula.
 */
function contrastText(bg: RGBA): RGBA {
  // RGBA stores 0-1 floats
  const lum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
  return lum > 0.5
    ? RGBA.fromInts(0, 0, 0)       // dark text on light bg
    : RGBA.fromInts(255, 255, 255); // light text on dark bg
}

/** Convert ANSI 256-color code to RGBA */
function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const colors = [
      "#000000", "#800000", "#008000", "#808000",
      "#000080", "#800080", "#008080", "#c0c0c0",
      "#808080", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    return RGBA.fromHex(colors[code] ?? "#000000");
  }
  if (code < 232) {
    const idx = code - 16;
    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55);
    return RGBA.fromInts(
      val(Math.floor(idx / 36)),
      val(Math.floor(idx / 6) % 6),
      val(idx % 6),
    );
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8;
    return RGBA.fromInts(gray, gray, gray);
  }
  return RGBA.fromInts(0, 0, 0);
}
