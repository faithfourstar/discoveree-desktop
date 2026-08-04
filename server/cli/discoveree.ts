/**
 * `discoveree` — the thin CLI launcher (brief §8: a launcher, not a CLI
 * product). One subcommand this sprint:
 *
 *   discoveree mcp serve [--product <slug>] [--data-dir <path>]
 *
 * Everything user-facing goes to STDERR — stdout belongs to the MCP stdio
 * transport.
 */
import { mcpServe } from "./mcpServe.js";

function parseFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`[discoveree] ${name} requires a value.`);
    process.exit(2);
  }
  return value;
}

const USAGE = `Usage: discoveree mcp serve [--product <slug>] [--data-dir <path>]

Serves this machine's Discoveree context over MCP (stdio). When the Discoveree
app is running, this bridges to it; when it is closed, the context is served
headless directly from the local database.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "mcp" && args[1] === "serve") {
    await mcpServe({
      productPin: parseFlag(args, "--product"),
      dataDirOverride: parseFlag(args, "--data-dir"),
    });
    return;
  }
  console.error(USAGE);
  process.exit(args.length === 0 ? 0 : 2);
}

void main();
