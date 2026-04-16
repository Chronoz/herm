/**
 * Theme React context — provides resolved theme to all components.
 *
 * Usage:
 *   // In app root:
 *   <ThemeProvider><App /></ThemeProvider>
 *
 *   // In any component:
 *   const { theme, name, set, names } = useTheme();
 *   <box backgroundColor={theme.backgroundPanel}>
 *   <text fg={theme.text}>
 */

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { Theme, ThemeJson } from "./types";
import { resolveTheme } from "./resolve";
import { DEFAULT_THEMES, DEFAULT_THEME } from "./builtin";
import { syntax } from "./syntax";
import * as preferences from "../utils/preferences";

interface ThemeContext {
  /** Resolved theme — all RGBA values ready for JSX props */
  theme: Theme;
  /** SyntaxStyle for code/markdown rendering */
  syntaxStyle: SyntaxStyle;
  /** Currently active theme name */
  name: string;
  /** Dark or light mode */
  mode: "dark" | "light";
  /** Switch to a theme by name. Returns false if not found. */
  set: (name: string) => boolean;
  /** All available theme names, sorted */
  names: string[];
  /** Check if a theme exists */
  has: (name: string) => boolean;
}

const Ctx = createContext<ThemeContext | null>(null);

interface ThemeProviderProps {
  children: any;
  initial?: string;
  mode?: "dark" | "light";
}

export const ThemeProvider = ({
  children,
  initial,
  mode: initialMode = "dark",
}: ThemeProviderProps) => {
  const [active, setActive] = useState(initial ?? DEFAULT_THEME);
  const [mode] = useState(initialMode);
  const [themes] = useState<Record<string, ThemeJson>>(DEFAULT_THEMES);

  const resolved = useMemo(() => {
    const json = themes[active] ?? themes[DEFAULT_THEME];
    try {
      return resolveTheme(json, mode);
    } catch {
      return resolveTheme(themes[DEFAULT_THEME], mode);
    }
  }, [active, mode, themes]);

  const names = useMemo(
    () => Object.keys(themes).sort(),
    [themes],
  );

  const set = useCallback(
    (name: string) => {
      if (!themes[name]) return false;
      setActive(name);
      preferences.set("theme", name);
      return true;
    },
    [themes],
  );

  const has = useCallback(
    (name: string) => themes[name] !== undefined,
    [themes],
  );

  const syntaxStyle = useMemo(() => syntax(resolved), [resolved]);

  const value = useMemo<ThemeContext>(() => ({
    theme: resolved,
    syntaxStyle,
    name: active,
    mode,
    set,
    names,
    has,
  }), [resolved, syntaxStyle, active, mode, set, names, has]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** Access the current theme. Must be inside <ThemeProvider>. */
export const useTheme = (): ThemeContext => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme() must be used inside <ThemeProvider>");
  return ctx;
};
