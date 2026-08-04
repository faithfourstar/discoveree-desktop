#!/usr/bin/env node
// Dev-era bin shim (ADR 005 §5.3): settles the `discoveree` name for
// `npm link` dogfood. Packaging (sprint 7) replaces this with the bundled
// binary behind the same name.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, "../server/cli/discoveree.ts");

const child = spawn("npx", ["tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
