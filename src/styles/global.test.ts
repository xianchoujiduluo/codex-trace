// Integrity checks for the single stylesheet.
//
// jsdom never loads `global.css`, so `getComputedStyle` in a component test is
// vacuous — these checks read the stylesheet as *text* instead. The token check
// exists because a `var(--x)` with no fallback and no definition is silently
// dropped by the browser (`--bg-panel` was missing for a while, which is why the
// sidebar shipped with no background at all). Nothing in tsc/oxlint/oxfmt can
// see that class of bug.
//
// The shared jsdom setup runs here too; it costs a little time but keeps the
// suite on one environment.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `import.meta.url` is an http:// URL under jsdom, so resolve from the repo root
// the same way build/version.ts does.
const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Custom properties declared anywhere in the stylesheet. */
function declaredTokens(): Set<string> {
  const declared = new Set<string>();
  for (const match of withoutComments.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/gm)) {
    declared.add(match[1]);
  }
  return declared;
}

/** `var(--x)` references, with the line they appear on and whether they have a fallback. */
function tokenReferences(): { line: number; name: string; hasFallback: boolean }[] {
  const refs: { line: number; name: string; hasFallback: boolean }[] = [];
  withoutComments.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      refs.push({ line: index + 1, name: match[1], hasFallback: match[2] === "," });
    }
  });
  return refs;
}

describe("global.css token integrity", () => {
  it("has a palette to check", () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(declaredTokens().size).toBeGreaterThan(50);
  });

  it("defines every token it reads without a fallback", () => {
    const declared = declaredTokens();
    const missing = tokenReferences()
      .filter((ref) => !ref.hasFallback && !declared.has(ref.name))
      .map((ref) => `line ${ref.line}: ${ref.name}`);

    expect(missing).toEqual([]);
  });

  it("keeps var() fallbacks in step with the palette they shadow", () => {
    // `var(--x, #hex)` silently diverges from `--x` when the palette is retuned,
    // so every colour fallback has to agree with the value it is shadowing.
    // Font stacks are exempt: `var(--font-mono, monospace)` is deliberately
    // degrading to a generic family, not duplicating the stack.
    const HEX = /^#[0-9a-f]{3,8}$/i;
    const declared = new Map<string, string>();
    for (const match of withoutComments.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:\s*([^;{}\n]+);/gm)) {
      declared.set(match[1], match[2].trim());
    }

    const drifted: string[] = [];
    withoutComments.split("\n").forEach((text, index) => {
      for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*,\s*([^)]+)\)/g)) {
        const [, name, fallback] = match;
        const value = declared.get(name);
        if (!value || !HEX.test(value) || !HEX.test(fallback.trim())) continue;
        if (value.toLowerCase() !== fallback.trim().toLowerCase()) {
          drifted.push(
            `line ${index + 1}: ${name} is ${value} but falls back to ${fallback.trim()}`,
          );
        }
      }
    });

    expect(drifted).toEqual([]);
  });

  it("keeps every custom color in a token", () => {
    // Black stays literal: shadows and modal scrims dim whatever is behind them,
    // they are not part of the palette and must not shift hue on a retheme.
    const stray = withoutComments
      .split("\n")
      .map((text, index) => ({ text, line: index + 1 }))
      .filter(
        ({ text }) => /(?<![\w-])rgba?\(/.test(text) && !/rgba?\(\s*0\s*,\s*0\s*,\s*0\b/.test(text),
      )
      .map(({ text, line }) => `line ${line}: ${text.trim()}`);

    expect(stray).toEqual([]);
  });
});

describe("global.css layout invariants", () => {
  it("drives the reading column from one token", () => {
    expect(declaredTokens().has("--reading-width")).toBe(true);

    const columnRules = withoutComments
      .split("\n")
      .map((text) => text.trim())
      .filter((text) => /^max-width:\s*var\(--reading-width/.test(text));

    // The chat transcript, the turn detail, the message detail, the picker rows
    // and the load-more button all share the one column.
    expect(columnRules).toHaveLength(5);
    expect(columnRules.every((text) => text === "max-width: var(--reading-width);")).toBe(true);
  });

  it("gives each sidebar session row a single right-aligned timestamp", () => {
    const rule = /\.sidebar-tree__time\s*\{([^}]*)\}/.exec(withoutComments)?.[1] ?? "";
    expect(rule).toMatch(/margin-left:\s*auto/);
    expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
  });

  it("separates sidebar groups with a border rather than relying on whitespace", () => {
    const rule = /\.sidebar-tree__group-header\s*\{([^}]*)\}/.exec(withoutComments)?.[1] ?? "";
    expect(rule).toMatch(/border-top:\s*1px solid var\(--border\)/);
  });
});
