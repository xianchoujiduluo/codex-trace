// The JS half of the palette has to mirror the CSS half.
//
// `src/lib/theme.ts` exists because a few consumers need a colour as a *value*
// (react-syntax-highlighter wants a style object, and `TurnDetail` sets a
// `backgroundColor` inline) and can't use a CSS custom property. Nothing links
// the two files, so retuning `global.css` and forgetting `theme.ts` silently
// produces a half-restyled app — that mismatch is what this guards.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "./theme";

const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

/** `:root` custom properties, as a name → value map. */
function cssTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:\s*([^;{}\n]+);/gm)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

// The contract: every `colors` entry that names a palette colour points at the
// matching CSS token. Keys that are JS-only (there are none today) would be
// listed separately rather than dropped silently.
const MIRRORED: Record<keyof typeof colors, string> = {
  bg: "--bg",
  bgPanel: "--bg-panel",
  bgSurface: "--bg-surface",
  bgElevated: "--bg-elevated",
  bgHover: "--bg-hover",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textDim: "--text-dim",
  textMuted: "--text-muted",
  accent: "--accent",
  error: "--error",
  info: "--info",
  border: "--border",
  modelGpt4: "--model-sonnet",
  modelGpt5: "--model-haiku",
  modelO: "--token-high",
  tokenHigh: "--token-high",
  ongoing: "--ongoing",
  contextOk: "--context-ok",
  contextWarn: "--context-warn",
  contextCrit: "--context-crit",
  toolExec: "--text-dim",
  toolPatch: "--ongoing",
  toolMcp: "--icon-mcp",
  toolWeb: "--accent",
  toolImage: "--icon-image",
  collab: "--collab-badge",
};

describe("theme.ts mirrors the stylesheet palette", () => {
  it("covers every exported colour", () => {
    expect(Object.keys(MIRRORED).toSorted()).toEqual(Object.keys(colors).toSorted());
  });

  it.each(Object.entries(MIRRORED))("%s matches its CSS token", (key, token) => {
    const value = cssTokens().get(token);
    expect(value, `${token} is not defined in global.css`).toBeDefined();
    expect(colors[key as keyof typeof colors].toLowerCase()).toBe(value?.toLowerCase());
  });
});
