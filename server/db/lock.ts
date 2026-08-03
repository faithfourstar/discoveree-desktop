/**
 * The single-writer lock (ADR 001 §2 — "this is the sharp edge").
 *
 * PGlite is single-connection and single-process: two PGlite instances opened
 * on the same data directory can corrupt it, and there is no postmaster to
 * stop you. Every process must acquire this lock BEFORE opening PGlite on a
 * real data directory.
 *
 * The lock file (`<dataDir>/db.lock`) carries the holder's PID and its
 * localhost MCP port, which doubles as the headless CLI's proxy-or-open
 * switch:
 *
 * - App running, CLI starts → the CLI finds the lock, reads the app's MCP
 *   port from it, and proxies stdio ⇄ localhost HTTP MCP instead of opening
 *   the DB.
 * - App closed, CLI starts → CLI acquires the lock and opens PGlite directly.
 * - CLI running headless, app starts → the app must win (it is the writer):
 *   it reads the CLI's PID from the lock, sends SIGTERM, waits for release,
 *   then acquires.
 *
 * Stale locks (holder crashed without releasing) are detected via PID
 * liveness and recovered automatically.
 *
 * Note: the ADR suggested "proper-lockfile semantics". The `proper-lockfile`
 * package cannot store holder metadata (PID + MCP port) in the lock, which
 * this design requires, so the lock is implemented directly with atomic
 * `wx`-mode file creation and PID-liveness stale detection.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const LOCK_FILE_NAME = "db.lock";

/** Contents of the lock file. */
export interface WriterLockInfo {
  pid: number;
  /** Localhost HTTP MCP port of the holder, when it is serving one. */
  mcpPort: number | null;
  hostname: string;
  acquiredAt: string; // ISO 8601
}

export interface WriterLockHandle {
  readonly lockPath: string;
  readonly info: WriterLockInfo;
  /** Rewrite the lock with a new MCP port (atomic write-then-rename). */
  setMcpPort(port: number | null): Promise<void>;
  /** Remove the lock. Idempotent; never removes another process's lock. */
  release(): Promise<void>;
}

export type AcquireWriterLockResult =
  | { acquired: true; handle: WriterLockHandle }
  | { acquired: false; holder: WriterLockInfo };

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 50;
/** An unparseable lock file younger than this may be mid-write; wait it out. */
const CORRUPT_GRACE_MS = 5_000;

export function lockFilePath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILE_NAME);
}

/** Is a process with this PID alive (or at least not provably dead)? */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM = exists but owned by someone else; anything unknown → assume alive
    // (refusing to open is always safer than a double open).
    return true;
  }
}

function parseLockInfo(raw: string): WriterLockInfo | null {
  try {
    const value = JSON.parse(raw) as Partial<WriterLockInfo>;
    if (typeof value.pid !== "number") return null;
    return {
      pid: value.pid,
      mcpPort: typeof value.mcpPort === "number" ? value.mcpPort : null,
      hostname: typeof value.hostname === "string" ? value.hostname : "",
      acquiredAt: typeof value.acquiredAt === "string" ? value.acquiredAt : "",
    };
  } catch {
    return null;
  }
}

/** Read the current lock, if any. Returns null when absent or unreadable. */
export async function readWriterLock(dataDir: string): Promise<WriterLockInfo | null> {
  try {
    const raw = await fs.readFile(lockFilePath(dataDir), "utf8");
    return parseLockInfo(raw);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to remove a stale lock without clobbering a fresh one.
 *
 * The file is atomically renamed aside first — only the process that wins the
 * rename may delete it, which closes the "two processes both unlink the stale
 * lock and then race to recreate it" corruption window. If the renamed file
 * turns out not to be the stale lock we observed (a new holder appeared in
 * between), it is put back.
 */
async function removeStaleLock(lockPath: string, stale: WriterLockInfo): Promise<void> {
  const claimPath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fs.rename(lockPath, claimPath);
  } catch {
    // Someone else already removed/claimed it — fine.
    return;
  }
  let claimed: WriterLockInfo | null = null;
  try {
    claimed = parseLockInfo(await fs.readFile(claimPath, "utf8"));
  } catch {
    claimed = null;
  }
  if (claimed && claimed.pid !== stale.pid && isPidAlive(claimed.pid)) {
    // We renamed a fresh lock aside by mistake (raced a takeover). Restore it
    // unless yet another lock has appeared at the canonical path.
    try {
      await fs.access(lockPath);
      // A new lock exists; drop our claim quietly.
      await fs.unlink(claimPath).catch(() => {});
    } catch {
      await fs.rename(claimPath, lockPath).catch(() => {});
    }
    return;
  }
  await fs.unlink(claimPath).catch(() => {});
}

/**
 * Acquire the exclusive writer lock for a data directory.
 *
 * Returns `{ acquired: false, holder }` when another live process holds it —
 * the caller decides what to do (CLI: proxy to `holder.mcpPort`; app: signal
 * `holder.pid` and retry). A lock held by a dead PID is treated as stale and
 * recovered. A second acquire from the SAME process is refused like any other
 * live holder — one handle per process.
 */
export async function acquireWriterLock(
  dataDir: string,
  options: { mcpPort?: number | null } = {},
): Promise<AcquireWriterLockResult> {
  if (dataDir.startsWith("memory://")) {
    throw new Error("acquireWriterLock() is meaningless for in-memory databases.");
  }
  const lockPath = lockFilePath(dataDir);
  await fs.mkdir(dataDir, { recursive: true });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const info: WriterLockInfo = {
      pid: process.pid,
      mcpPort: options.mcpPort ?? null,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
    };
    // Attempt atomic creation — fails with EEXIST when a lock is present.
    try {
      const fh = await fs.open(lockPath, "wx");
      try {
        await fh.writeFile(`${JSON.stringify(info)}\n`, "utf8");
        await fh.sync();
      } finally {
        await fh.close();
      }
      return { acquired: true, handle: createHandle(lockPath, info) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      lastError = err;
    }

    // A lock file exists. Inspect the holder.
    let raw: string | null = null;
    try {
      raw = await fs.readFile(lockPath, "utf8");
    } catch {
      // Vanished between open and read — retry.
      await delay(RETRY_DELAY_MS);
      continue;
    }
    const holder = parseLockInfo(raw);
    if (!holder) {
      // Unparseable: may be mid-write by another process. Give it a grace
      // period based on file age before declaring it corrupt-and-stale.
      let ageMs = Number.POSITIVE_INFINITY;
      try {
        ageMs = Date.now() - (await fs.stat(lockPath)).mtimeMs;
      } catch {
        // Vanished — retry.
      }
      if (ageMs < CORRUPT_GRACE_MS) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      await removeStaleLock(lockPath, { pid: -1, mcpPort: null, hostname: "", acquiredAt: "" });
      continue;
    }
    if (isPidAlive(holder.pid)) {
      return { acquired: false, holder };
    }
    // Holder is dead — recover the stale lock and retry.
    await removeStaleLock(lockPath, holder);
  }
  throw new Error(
    `Could not acquire the writer lock at ${lockPath} after ${MAX_ATTEMPTS} attempts` +
      (lastError ? ` (last error: ${String(lastError)})` : ""),
  );
}

function createHandle(lockPath: string, initialInfo: WriterLockInfo): WriterLockHandle {
  let info = initialInfo;
  let released = false;

  async function verifyOwnership(): Promise<boolean> {
    try {
      const current = parseLockInfo(await fs.readFile(lockPath, "utf8"));
      return current !== null && current.pid === process.pid;
    } catch {
      return false;
    }
  }

  return {
    lockPath,
    get info() {
      return info;
    },
    async setMcpPort(port: number | null): Promise<void> {
      if (released) throw new Error("Writer lock has been released.");
      if (!(await verifyOwnership())) {
        throw new Error(`Writer lock at ${lockPath} is no longer held by this process.`);
      }
      const next: WriterLockInfo = { ...info, mcpPort: port };
      const tmpPath = `${lockPath}.tmp-${process.pid}-${randomUUID()}`;
      await fs.writeFile(tmpPath, `${JSON.stringify(next)}\n`, "utf8");
      await fs.rename(tmpPath, lockPath);
      info = next;
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      // Never delete a lock we no longer own (e.g. after a stale takeover).
      if (await verifyOwnership()) {
        await fs.unlink(lockPath).catch(() => {});
      }
    },
  };
}
