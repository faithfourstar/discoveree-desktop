/**
 * "Set up automatically" for Claude Desktop (live-user finding, 4 Aug 2026 —
 * the client button previously wrote NOTHING). Merges the spawn-proof
 * discoveree entry into Claude Desktop's config file:
 *
 * - creates the directory/file when absent;
 * - NEVER clobbers other servers' entries (merge, don't replace);
 * - takes a timestamped `.backup-<epoch>` sibling before every write to an
 *   existing file;
 * - overwriting an existing discoveree entry is an UPDATE, reported as
 *   `replacedExisting: true`;
 * - an unparseable existing config is never overwritten — structured error.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildStdioEntry, type StdioEntry } from "./cliInvocation.js";

/**
 * macOS path (dev era — macOS-first dogfood, ADR 005 risk 2). Packaging
 * sprint seam for the other platforms:
 *   Windows: path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json")
 *   Linux:   path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json")
 */
export function defaultClaudeDesktopConfigPath(): string {
  return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

export type ClaudeDesktopSetupResult =
  | {
      written: true;
      configPath: string;
      entry: StdioEntry;
      replacedExisting: boolean;
      backupPath: string | null;
      commandResolved: boolean;
    }
  | {
      written: false;
      error: "config-unparseable" | "config-unwritable";
      message: string;
      configPath: string;
    };

export async function setupClaudeDesktopConfig(
  configPath: string = defaultClaudeDesktopConfigPath(),
): Promise<ClaudeDesktopSetupResult> {
  const { entry, commandResolved } = buildStdioEntry();

  // Read the existing config, if any. An unparseable file is NEVER clobbered.
  let existing: Record<string, unknown> = {};
  let fileExists = false;
  try {
    const raw = await fs.readFile(configPath, "utf8");
    fileExists = true;
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        existing = parsed as Record<string, unknown>;
      } catch {
        return {
          written: false,
          error: "config-unparseable",
          message:
            "The existing Claude Desktop config file could not be parsed as JSON, so Discoveree has not touched it. " +
            "Fix or remove the file, then try again.",
          configPath,
        };
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        written: false,
        error: "config-unwritable",
        message: `The Claude Desktop config file could not be read: ${err instanceof Error ? err.message : String(err)}`,
        configPath,
      };
    }
  }

  // Merge, don't replace: only the discoveree entry is ours to write.
  const mcpServers = (existing["mcpServers"] && typeof existing["mcpServers"] === "object" && !Array.isArray(existing["mcpServers"])
    ? existing["mcpServers"]
    : {}) as Record<string, unknown>;
  const replacedExisting = "discoveree" in mcpServers;
  const next = {
    ...existing,
    mcpServers: { ...mcpServers, discoveree: entry },
  };

  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    // Timestamped backup sibling before writing over an existing file.
    let backupPath: string | null = null;
    if (fileExists) {
      backupPath = `${configPath}.backup-${Date.now()}`;
      await fs.copyFile(configPath, backupPath);
    }

    await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { written: true, configPath, entry, replacedExisting, backupPath, commandResolved };
  } catch (err) {
    return {
      written: false,
      error: "config-unwritable",
      message: `The Claude Desktop config could not be written: ${err instanceof Error ? err.message : String(err)}. Check the file permissions and try again.`,
      configPath,
    };
  }
}
