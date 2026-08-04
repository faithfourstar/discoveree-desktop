/**
 * setup endpoint module (connections-spec §2.4) — suites use a temp path and
 * NEVER touch the real Claude Desktop config.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupClaudeDesktopConfig } from "../claudeDesktopSetup.js";

let dir: string;
let cfg: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dcd-setup-"));
  cfg = path.join(dir, "nested", "claude_desktop_config.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("setupClaudeDesktopConfig", () => {
  it("fresh write: creates dirs + file, spawn-proof entry, no backup", async () => {
    const res = await setupClaudeDesktopConfig(cfg);
    expect(res.written).toBe(true);
    if (!res.written) return;
    expect(res.replacedExisting).toBe(false);
    expect(res.backupPath).toBeNull();
    // The spawn-proof invocation shape: absolute node, repo tsx cli.mjs,
    // --tsconfig pinned. A regression to npx breaks Claude Desktop spawns
    // (cwd-dependent tsconfig resolution → ERR_MODULE_NOT_FOUND) — see
    // cliInvocation.ts header.
    expect(res.entry.command).toBe(process.execPath);
    expect(res.entry.command.endsWith("npx")).toBe(false);
    expect(res.entry.args[0]).toMatch(/node_modules\/tsx\/dist\/cli\.mjs$/);
    expect(res.entry.args[1]).toBe("--tsconfig");
    const disk = JSON.parse(await fs.readFile(cfg, "utf8"));
    expect(disk.mcpServers.discoveree.command).toBe(process.execPath);
  });

  it("merge-preserve: other servers survive byte-for-byte; backup taken", async () => {
    await fs.mkdir(path.dirname(cfg), { recursive: true });
    await fs.writeFile(cfg, JSON.stringify({
      mcpServers: { other: { command: "other-cmd", args: ["x"] } },
      unrelatedTopLevel: 42,
    }));
    const res = await setupClaudeDesktopConfig(cfg);
    expect(res.written).toBe(true);
    if (!res.written) return;
    expect(res.replacedExisting).toBe(false);
    expect(res.backupPath).toMatch(/\.backup-\d+$/);
    const disk = JSON.parse(await fs.readFile(cfg, "utf8"));
    expect(disk.mcpServers.other).toEqual({ command: "other-cmd", args: ["x"] });
    expect(disk.unrelatedTopLevel).toBe(42);
    expect(disk.mcpServers.discoveree).toBeDefined();
  });

  it("existing discoveree entry: overwritten and reported as replacedExisting", async () => {
    await fs.mkdir(path.dirname(cfg), { recursive: true });
    await fs.writeFile(cfg, JSON.stringify({ mcpServers: { discoveree: { command: "stale" } } }));
    const res = await setupClaudeDesktopConfig(cfg);
    expect(res.written).toBe(true);
    if (!res.written) return;
    expect(res.replacedExisting).toBe(true);
  });

  it("unparseable existing config: refused, nothing changed", async () => {
    await fs.mkdir(path.dirname(cfg), { recursive: true });
    await fs.writeFile(cfg, "{ not json");
    const res = await setupClaudeDesktopConfig(cfg);
    expect(res.written).toBe(false);
    if (res.written) return;
    expect(res.error).toBe("config-unparseable");
    expect(await fs.readFile(cfg, "utf8")).toBe("{ not json");
  });
});

describe("tool annotations", () => {
  it("all twelve tools carry titles; reads are readOnly, writes are not", async () => {
    await import("../tools/read.js");
    await import("../tools/write.js");
    const { listToolDefs } = await import("../registry.js");
    const defs = listToolDefs();
    expect(defs.length).toBe(12);
    for (const def of defs) {
      expect(def.title.length, def.name).toBeGreaterThan(0);
      expect(def.title).not.toMatch(/_/);
    }
    expect(defs.filter((d) => d.category === "read").length).toBe(10);
    expect(defs.filter((d) => d.category === "write").map((d) => d.name).sort()).toEqual([
      "log_feedback",
      "propose_competitor_intel",
    ]);
  });
});
