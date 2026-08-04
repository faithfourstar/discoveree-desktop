/**
 * CLI invocation resolver (ADR 005 §5.1) — one resolver so Settings and
 * onboarding snippets are copy-paste-TRUE for the install rendering them,
 * never a hardcoded string that lies on someone's machine.
 *
 * THE INVOCATION (live-debugged on the owner's real Claude Desktop
 * connection, 4 Aug 2026 — verified under simulated GUI conditions
 * cwd=/, PATH=/usr/bin:/bin:/usr/sbin:/sbin):
 *
 *   command: <absolute node>            (process.execPath — the running
 *                                        server's own node, resolved at
 *                                        request time)
 *   args:    [<repo>/node_modules/tsx/dist/cli.mjs,
 *             "--tsconfig", <repo>/tsconfig.json,
 *             <repo>/server/cli/discoveree.ts, "mcp", "serve"]
 *
 * Why NOT `npx tsx`: GUI apps spawn with a bare PATH from their own cwd —
 * npx fetched a CACHED GLOBAL tsx and tsx resolved tsconfig from the cwd, so
 * the @shared/* path alias failed (ERR_MODULE_NOT_FOUND) and the server died
 * on boot ("Server disconnected"). Pinning the repo's own tsx cli.mjs and
 * --tsconfig makes the spawn environment irrelevant. Packaged era (sprint 7):
 * the bundled binary path replaces this resolution behind the same function.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "../db/dataDir.js";
import { resolveServerPort } from "../http/serverPort.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/mcp/ → the repo root. */
const REPO_ROOT = path.resolve(HERE, "../..");

export interface CliInvocation {
  kind: "packaged" | "dev";
  command: string;
  args: string[];
}

export interface StdioEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * The spawn-environment-proof stdio entry, resolved at request time:
 * - command is the running server's own node (process.execPath — absolute by
 *   definition, and known-working since it is running this very server);
 * - args pin the repo's tsx cli.mjs AND --tsconfig so neither PATH nor cwd
 *   matters in the spawning app;
 * - env.DISCOVEREE_DATA_DIR is included whenever this server's resolved
 *   dataDir differs from the DEFAULT resolution (env override — our dev
 *   reality). Without it the spawned CLI opens a different, EMPTY database
 *   and serves an empty context layer — the worst silent failure this
 *   surface can have (confirmed live).
 *
 * `commandResolved: false` means the dev-era invocation files (the repo's
 * tsx cli.mjs / CLI entry) could not be found — the client surfaces the
 * caveat instead of shipping a snippet that dies on boot.
 */
export function buildStdioEntry(env: NodeJS.ProcessEnv = process.env): { entry: StdioEntry; commandResolved: boolean } {
  const tsxCli = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const tsconfig = path.join(REPO_ROOT, "tsconfig.json");
  const cliEntry = path.join(REPO_ROOT, "server", "cli", "discoveree.ts");

  const commandResolved = existsSync(tsxCli) && existsSync(cliEntry) && existsSync(tsconfig);

  const entry: StdioEntry = {
    command: process.execPath,
    args: [tsxCli, "--tsconfig", tsconfig, cliEntry, "mcp", "serve"],
  };

  const actualDataDir = resolveDataDir(env);
  const defaultDataDir = resolveDataDir({});
  if (actualDataDir !== defaultDataDir) {
    entry.env = { DISCOVEREE_DATA_DIR: actualDataDir };
  }

  return { entry, commandResolved };
}

export function resolveCliInvocation(): CliInvocation {
  const { entry } = buildStdioEntry();
  return { kind: "dev", command: entry.command, args: entry.args };
}

export interface McpConfigSnippets {
  /** ServingStatus block (connections-spec): what THIS install serves, honestly. */
  servingPort: number;
  httpUrl: string;
  /** Absolute path to the CLI entry — honest pre-packaging (dev era). */
  cliPath: string;
  transports: { http: boolean; stdio: boolean };
  /** LAN exposure is a 5b opt-in — null until it exists. */
  lanAddress: string | null;
  invocation: CliInvocation;
  /** The spawn-environment-proof stdio entry every stdio snippet embeds. */
  stdioEntry: StdioEntry;
  /** False = the dev-era invocation files were not found; client surfaces the caveat. */
  commandResolved: boolean;
  /** True when the entry carries env.DISCOVEREE_DATA_DIR (non-default dataDir). */
  envIncluded: boolean;
  snippets: {
    claudeDesktop: Record<string, unknown>;
    claudeCodeHttp: string;
    claudeCodeStdio: Record<string, unknown>;
    cursor: Record<string, unknown>;
    chatgpt: { connectable: false; reason: string };
  };
}

/** Per-tool snippets + serving status for Settings → Connections (§5.1/§5.2). */
export function buildMcpConfigSnippets(env: NodeJS.ProcessEnv = process.env): McpConfigSnippets {
  const port = resolveServerPort();
  const httpUrl = `http://127.0.0.1:${port}/mcp`;
  const { entry, commandResolved } = buildStdioEntry(env);
  const cliPath = entry.args[3] ?? "";
  const stdioBlock = { mcpServers: { discoveree: entry } };
  return {
    servingPort: port,
    httpUrl,
    cliPath,
    transports: { http: true, stdio: true },
    lanAddress: null,
    invocation: { kind: "dev", command: entry.command, args: entry.args },
    stdioEntry: entry,
    commandResolved,
    envIncluded: !!entry.env,
    snippets: {
      claudeDesktop: stdioBlock,
      claudeCodeHttp: `claude mcp add --transport http discoveree ${httpUrl}`,
      claudeCodeStdio: stdioBlock,
      cursor: stdioBlock,
      chatgpt: {
        connectable: false,
        reason: "ChatGPT connectors require a remote HTTPS endpoint — the team-tier remote connector. Local MCP serves Claude Desktop, Claude Code and Cursor today.",
      },
    },
  };
}
