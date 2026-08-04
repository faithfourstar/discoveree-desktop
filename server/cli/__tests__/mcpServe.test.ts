/**
 * `discoveree mcp serve` decision flow (ADR 005 §1.1) on the real lock-file
 * handshake — transports stubbed out entirely: this asserts the proxy-or-
 * headless DECISION and the --product pin bridge middleware.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { lockFilePath, readWriterLock } from "../../db/lock.js";
import { applyProductPin } from "../proxy.js";
import { decideServeMode } from "../mcpServe.js";

const tempDirs: string[] = [];

function tempDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "discoveree-mcp-serve-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeLock(dataDir: string, info: { pid: number; mcpPort: number | null }): void {
  writeFileSync(lockFilePath(dataDir), `${JSON.stringify({
    pid: info.pid,
    mcpPort: info.mcpPort,
    hostname: "test",
    acquiredAt: new Date().toISOString(),
  })}\n`, "utf8");
}

describe("decideServeMode (§1.1)", () => {
  it("no lock → HEADLESS, holding the writer lock (released after)", async () => {
    const dataDir = tempDataDir();
    const { decision, handle } = await decideServeMode(dataDir);
    expect(decision).toEqual({ mode: "headless" });
    expect(handle).toBeTruthy();
    const lock = await readWriterLock(dataDir);
    expect(lock?.pid).toBe(process.pid);
    await handle!.release();
  });

  it("a live holder with a published port → PROXY to that port (uniform — app or sibling CLI)", async () => {
    const dataDir = tempDataDir();
    writeLock(dataDir, { pid: process.pid, mcpPort: 7317 });
    const { decision, handle } = await decideServeMode(dataDir);
    expect(decision).toEqual({ mode: "proxy", port: 7317 });
    expect(handle).toBeNull();
  });

  it("a live holder mid-startup (no port yet) is polled; the published port wins", async () => {
    const dataDir = tempDataDir();
    writeLock(dataDir, { pid: process.pid, mcpPort: null });
    setTimeout(() => writeLock(dataDir, { pid: process.pid, mcpPort: 7411 }), 120);
    const { decision } = await decideServeMode(dataDir, { waitMs: 2000, pollMs: 40 });
    expect(decision).toEqual({ mode: "proxy", port: 7411 });
  });

  it("a holder that never publishes a port → an honest error, not a hang", async () => {
    const dataDir = tempDataDir();
    writeLock(dataDir, { pid: process.pid, mcpPort: null });
    const { decision } = await decideServeMode(dataDir, { waitMs: 200, pollMs: 40 });
    expect(decision.mode).toBe("error");
    expect((decision as { message: string }).message).toMatch(/not published an MCP port/i);
  });

  it("a STALE lock (dead pid) is recovered → HEADLESS", async () => {
    const dataDir = tempDataDir();
    writeLock(dataDir, { pid: 999999999, mcpPort: 7317 }); // provably dead
    const { decision, handle } = await decideServeMode(dataDir);
    expect(decision).toEqual({ mode: "headless" });
    await handle!.release();
  });
});

describe("the --product pin bridge middleware (§2.3)", () => {
  const toolCall = (args: Record<string, unknown>): JSONRPCMessage => ({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "list_competitors", arguments: args },
  } as JSONRPCMessage);

  it("injects the pin when the parameter is absent", () => {
    const result = applyProductPin(toolCall({}), "acme-product");
    expect("forward" in result).toBe(true);
    const forwarded = (result as { forward: JSONRPCMessage }).forward as unknown as { params: { arguments: Record<string, unknown> } };
    expect(forwarded.params.arguments["product"]).toBe("acme-product");
  });

  it("passes through a matching explicit value", () => {
    const result = applyProductPin(toolCall({ product: "acme-product" }), "acme-product");
    expect("forward" in result).toBe(true);
  });

  it("REFUSES a mismatching explicit value locally with the deterministic product_pinned shape", () => {
    const result = applyProductPin(toolCall({ product: "sibling-product" }), "acme-product");
    expect("reject" in result).toBe(true);
    const rejection = (result as { reject: JSONRPCMessage }).reject as unknown as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(rejection.result.isError).toBe(true);
    const payload = JSON.parse(rejection.result.content[0]!.text);
    expect(payload.error).toBe("product_pinned");
    expect(payload.message).toContain("acme-product");
  });

  it("non-tool-call messages pass through untouched (the bridge stays dumb)", () => {
    const message = { jsonrpc: "2.0", id: 1, method: "tools/list" } as JSONRPCMessage;
    const result = applyProductPin(message, "acme-product");
    expect("forward" in result && (result as { forward: JSONRPCMessage }).forward).toBe(message);
  });
});
