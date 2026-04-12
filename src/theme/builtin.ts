/**
 * Built-in themes — imported statically from JSON files.
 * Same set as OpenCode.
 */

import type { ThemeJson } from "./types";

import aura from "./themes/aura.json";
import ayu from "./themes/ayu.json";
import carbonfox from "./themes/carbonfox.json";
import catppuccin from "./themes/catppuccin.json";
import catppuccinFrappe from "./themes/catppuccin-frappe.json";
import catppuccinMacchiato from "./themes/catppuccin-macchiato.json";
import cobalt2 from "./themes/cobalt2.json";
import cursor from "./themes/cursor.json";
import dracula from "./themes/dracula.json";
import everforest from "./themes/everforest.json";
import flexoki from "./themes/flexoki.json";
import github from "./themes/github.json";
import gruvbox from "./themes/gruvbox.json";
import kanagawa from "./themes/kanagawa.json";
import lucentOrng from "./themes/lucent-orng.json";
import material from "./themes/material.json";
import matrix from "./themes/matrix.json";
import mercury from "./themes/mercury.json";
import monokai from "./themes/monokai.json";
import nightowl from "./themes/nightowl.json";
import nord from "./themes/nord.json";
import oneDark from "./themes/one-dark.json";
import opencode from "./themes/opencode.json";
import orng from "./themes/orng.json";
import osakaJade from "./themes/osaka-jade.json";
import palenight from "./themes/palenight.json";
import rosepine from "./themes/rosepine.json";
import solarized from "./themes/solarized.json";
import synthwave84 from "./themes/synthwave84.json";
import tokyonight from "./themes/tokyonight.json";
import vercel from "./themes/vercel.json";
import vesper from "./themes/vesper.json";
import zenburn from "./themes/zenburn.json";

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura: aura as ThemeJson,
  ayu: ayu as ThemeJson,
  carbonfox: carbonfox as ThemeJson,
  catppuccin: catppuccin as ThemeJson,
  "catppuccin-frappe": catppuccinFrappe as ThemeJson,
  "catppuccin-macchiato": catppuccinMacchiato as ThemeJson,
  cobalt2: cobalt2 as ThemeJson,
  cursor: cursor as ThemeJson,
  dracula: dracula as ThemeJson,
  everforest: everforest as ThemeJson,
  flexoki: flexoki as ThemeJson,
  github: github as ThemeJson,
  gruvbox: gruvbox as ThemeJson,
  kanagawa: kanagawa as ThemeJson,
  "lucent-orng": lucentOrng as ThemeJson,
  material: material as ThemeJson,
  matrix: matrix as ThemeJson,
  mercury: mercury as ThemeJson,
  monokai: monokai as ThemeJson,
  nightowl: nightowl as ThemeJson,
  nord: nord as ThemeJson,
  "one-dark": oneDark as ThemeJson,
  opencode: opencode as ThemeJson,
  orng: orng as ThemeJson,
  "osaka-jade": osakaJade as ThemeJson,
  palenight: palenight as ThemeJson,
  rosepine: rosepine as ThemeJson,
  solarized: solarized as ThemeJson,
  synthwave84: synthwave84 as ThemeJson,
  tokyonight: tokyonight as ThemeJson,
  vercel: vercel as ThemeJson,
  vesper: vesper as ThemeJson,
  zenburn: zenburn as ThemeJson,
};

export const DEFAULT_THEME = "tokyonight";
