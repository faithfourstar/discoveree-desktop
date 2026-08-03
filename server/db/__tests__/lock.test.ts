import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  acquireWriterLock,
  readWriterLock,
  lockFilePath,
  isPidAlive,
  type WriterLockHandle,
} from '../lock.js';

let dataDir: string;
let handles: WriterLockHandle[];

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'discoveree-lock-test-'));
  handles = [];
});

afterEach(async () => {
  for (const handle of handles) {
    await handle.release();
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** PID of a process that has definitely exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  expect(child.pid).toBeGreaterThan(0);
  expect(isPidAlive(child.pid!)).toBe(false);
  return child.pid!;
}

describe('acquireWriterLock', () => {
  it('Given no existing lock, When acquired, Then the lock file carries our PID and MCP port', async () => {
    const result = await acquireWriterLock(dataDir, { mcpPort: 4823 });
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    handles.push(result.handle);

    const onDisk = JSON.parse(readFileSync(lockFilePath(dataDir), 'utf8'));
    expect(onDisk.pid).toBe(process.pid);
    expect(onDisk.mcpPort).toBe(4823);
    expect(typeof onDisk.acquiredAt).toBe('string');
  });

  it('Given a lock held by a live process, When a second acquire is attempted, Then it is refused and reports the holder', async () => {
    const first = await acquireWriterLock(dataDir, { mcpPort: 4823 });
    expect(first.acquired).toBe(true);
    if (first.acquired) handles.push(first.handle);

    const second = await acquireWriterLock(dataDir);
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    // The refused caller learns who holds the lock and where its MCP server
    // is — this is the CLI's proxy-or-open switch.
    expect(second.holder.pid).toBe(process.pid);
    expect(second.holder.mcpPort).toBe(4823);
  });

  it('Given a stale lock from a dead process, When acquired, Then the stale lock is recovered and acquisition succeeds', async () => {
    const stale = { pid: deadPid(), mcpPort: 9999, hostname: os.hostname(), acquiredAt: new Date().toISOString() };
    writeFileSync(lockFilePath(dataDir), `${JSON.stringify(stale)}\n`);

    const result = await acquireWriterLock(dataDir, { mcpPort: 5000 });
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    handles.push(result.handle);

    const onDisk = JSON.parse(readFileSync(lockFilePath(dataDir), 'utf8'));
    expect(onDisk.pid).toBe(process.pid);
    expect(onDisk.mcpPort).toBe(5000);
  });

  it('Given an old corrupt lock file, When acquired, Then the corrupt lock is treated as stale and recovered', async () => {
    writeFileSync(lockFilePath(dataDir), 'not json at all');
    // Backdate the mtime beyond the mid-write grace period.
    const past = new Date(Date.now() - 60_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(lockFilePath(dataDir), past, past);

    const result = await acquireWriterLock(dataDir);
    expect(result.acquired).toBe(true);
    if (result.acquired) handles.push(result.handle);
  });

  it('Given an in-memory location, When acquiring, Then it throws (locking is meaningless there)', async () => {
    await expect(acquireWriterLock('memory://')).rejects.toThrow(/in-memory/i);
  });
});

describe('release', () => {
  it('Given a held lock, When released, Then the lock file is removed and release is idempotent', async () => {
    const result = await acquireWriterLock(dataDir);
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;

    await result.handle.release();
    expect(existsSync(lockFilePath(dataDir))).toBe(false);
    await expect(result.handle.release()).resolves.toBeUndefined();
  });

  it('Given a lock taken over after a stale recovery, When the old handle releases, Then it does NOT remove the new holder\'s lock', async () => {
    const first = await acquireWriterLock(dataDir);
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;

    // Simulate another process having replaced the lock (e.g. after this
    // process was wrongly declared stale).
    const other = { pid: 1, mcpPort: null, hostname: os.hostname(), acquiredAt: new Date().toISOString() };
    writeFileSync(lockFilePath(dataDir), `${JSON.stringify(other)}\n`);

    await first.handle.release();
    // The foreign lock survives.
    expect(existsSync(lockFilePath(dataDir))).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockFilePath(dataDir), 'utf8'));
    expect(onDisk.pid).toBe(1);
    rmSync(lockFilePath(dataDir), { force: true });
  });

  it('Given a released lock, When another process acquires, Then it succeeds', async () => {
    const first = await acquireWriterLock(dataDir);
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;
    await first.handle.release();

    const second = await acquireWriterLock(dataDir);
    expect(second.acquired).toBe(true);
    if (second.acquired) handles.push(second.handle);
  });
});

describe('setMcpPort', () => {
  it('Given a held lock, When the MCP port changes, Then the lock file is rewritten with the new port', async () => {
    const result = await acquireWriterLock(dataDir, { mcpPort: null });
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    handles.push(result.handle);

    await result.handle.setMcpPort(6100);
    const info = await readWriterLock(dataDir);
    expect(info?.pid).toBe(process.pid);
    expect(info?.mcpPort).toBe(6100);

    await result.handle.setMcpPort(null);
    expect((await readWriterLock(dataDir))?.mcpPort).toBeNull();
  });

  it('Given a released lock, When setMcpPort is called, Then it throws', async () => {
    const result = await acquireWriterLock(dataDir);
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    await result.handle.release();
    await expect(result.handle.setMcpPort(7000)).rejects.toThrow(/released/i);
  });
});

describe('readWriterLock', () => {
  it('Given no lock file, When read, Then returns null', async () => {
    expect(await readWriterLock(dataDir)).toBeNull();
  });
});
