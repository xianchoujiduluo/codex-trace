// Theme constants — dark theme colors for codex-trace.
//
// Mirror of the `:root` palette in src/styles/global.css. Keep the two in sync:
// components that pass a colour to react-syntax-highlighter or set an inline
// style must read it from here, since inline styles can't use CSS variables.
//
// src/styles/global.test.ts guards the CSS side (every `var(--x)` it uses must
// be defined); this file is the JS side of the same palette.

export const colors = {
  // Background
  bg: "#1e1e1e",
  bgPanel: "#181818",
  bgSurface: "#252526",
  bgElevated: "#2d2d30",
  bgHover: "#2a2d2e",

  // Text hierarchy
  textPrimary: "#cccccc",
  textSecondary: "#9d9d9d",
  textDim: "#858585",
  textMuted: "#6e6e6e",

  // Accents
  accent: "#3794ff",
  error: "#f14c4c",
  info: "#3794ff",

  // Surfaces
  border: "#3c3c3c",

  // Model family (GPT variants)
  modelGpt4: "#3794ff",
  modelGpt5: "#89d185",
  modelO: "#cca700",

  // Token highlight
  tokenHigh: "#cca700",

  // Ongoing indicator
  ongoing: "#89d185",

  // Context usage thresholds
  contextOk: "#89d185",
  contextWarn: "#cca700",
  contextCrit: "#f14c4c",

  // Tool category colors
  toolExec: "#858585",
  toolPatch: "#89d185",
  toolMcp: "#a888e0",
  toolWeb: "#3794ff",
  toolImage: "#b180d7",

  // Collab
  collab: "#6f9fd8",
} as const;

/**
 * Syntax-highlighting colours for `react-syntax-highlighter`.
 *
 * The bundled `oneDark` theme is kept for token colours (its hues already match a
 * VS Code-ish palette), but its container background `#282c34` is blue-leaning and
 * clashes with the neutral gray surfaces. Overriding just the frame reuses the
 * theme instead of shipping a full custom one.
 */
export const syntaxHighlighterStyle = {
  background: colors.bgElevated,
  color: colors.textPrimary,
} as const;

export function getModelColor(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("o")) return colors.modelO;
  if (m.includes("gpt-5") || m.includes("gpt5")) return colors.modelGpt5;
  return colors.modelGpt4;
}

export function getContextColor(pct: number): string {
  if (pct < 50) return colors.contextOk;
  if (pct < 80) return colors.contextWarn;
  return colors.contextCrit;
}

// Spinner frames (braille)
export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
