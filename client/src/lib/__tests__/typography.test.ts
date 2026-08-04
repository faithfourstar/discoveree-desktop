import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Typography ruling grep rule (docs/design/typography-ruling.md §6, as
 * amended by the owner 4 Aug): `font-mono` may appear ONLY in
 *
 * - the `.mask` utility in index.css (key masks),
 * - code/config snippet blocks and the copyable prompt chip (Connections),
 * - key/address input fields (Settings).
 *
 * Any other `font-mono` in a component is a regression. The allowlist below
 * pins each sanctioned file to its exact occurrence count so new mono cannot
 * ride in on an already-allowed file.
 */

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALLOWED: Record<string, number> = {
  // Key + licence-key entry inputs.
  "pages/SettingsPage.tsx": 2,
  // The copyable command/address chip, the snippet filename caption and the
  // <pre> config block.
  "pages/ConnectionsPage.tsx": 3,
};

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // Tests may quote the pattern they police.
      if (entry !== "__tests__") {
        walk(path, files);
      }
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("typography grep rule", () => {
  it("font-mono appears only at the sanctioned developer-artifact sites", () => {
    const offenders: Record<string, number> = {};
    for (const file of walk(SRC_ROOT)) {
      const occurrences = (
        readFileSync(file, "utf8").match(/font-mono/g) ?? []
      ).length;
      if (occurrences > 0) {
        offenders[relative(SRC_ROOT, file)] = occurrences;
      }
    }
    expect(offenders).toEqual(ALLOWED);
  });

  it("the .mask utility exists and is the only mono composition mechanism", () => {
    const css = readFileSync(join(SRC_ROOT, "index.css"), "utf8");
    expect(css).toMatch(/\.mask\s*{[^}]*font-mono/);
    // `.data` is Inter + tabular figures — no mono face.
    const dataRule = /\.data\s*{([^}]*)}/.exec(css)?.[1] ?? "";
    expect(dataRule).not.toContain("font-mono");
    expect(dataRule).toContain("tabular-nums");
  });
});
