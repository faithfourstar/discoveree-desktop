import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureSecrets,
  decrypt,
  encrypt,
  maskApiKey,
  resetSecrets,
  SECRET_KEY_FILE_NAME,
} from "../secrets.js";

describe("lib/secrets (per-install secret.key, ADR 002 §4)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "discoveree-secrets-test-"));
  });

  afterEach(() => {
    resetSecrets();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("Given no secret.key, When encrypt is called, Then the key file is created with mode 0600 and round-trips", () => {
    configureSecrets(dataDir);
    const keyPath = path.join(dataDir, SECRET_KEY_FILE_NAME);
    expect(existsSync(keyPath)).toBe(false);

    const ciphertext = encrypt("sk-test-super-secret-key");

    expect(existsSync(keyPath)).toBe(true);
    const mode = statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);

    // iv:tag:ciphertext hex format — the SaaS crypto.ts format, unchanged
    expect(ciphertext.split(":")).toHaveLength(3);
    expect(decrypt(ciphertext)).toBe("sk-test-super-secret-key");
  });

  it("Given an existing secret.key, When a new process configures the same dir, Then previous ciphertext still decrypts", () => {
    configureSecrets(dataDir);
    const ciphertext = encrypt("pplx-round-trip-across-restarts");
    const keyMaterial = readFileSync(path.join(dataDir, SECRET_KEY_FILE_NAME), "utf8");

    // Simulate a fresh process: reset module state and re-configure.
    resetSecrets();
    configureSecrets(dataDir);

    expect(decrypt(ciphertext)).toBe("pplx-round-trip-across-restarts");
    // Key material was reused, not regenerated
    expect(readFileSync(path.join(dataDir, SECRET_KEY_FILE_NAME), "utf8")).toBe(keyMaterial);
  });

  it("Given a stored key, When masked, Then only the first/last four characters show", () => {
    configureSecrets(dataDir);
    const ciphertext = encrypt("sk-ant-abcdefghijklmnop");
    expect(maskApiKey(ciphertext)).toBe("sk-a...mnop");
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey("not-valid-ciphertext")).toBe("****");
  });

  it("Given secrets are not configured, When encrypt is called, Then it throws a clear error", () => {
    expect(() => encrypt("anything")).toThrow(/configureSecrets/);
  });

  it("Given a different data dir (different key), When decrypting old ciphertext, Then it fails safely", () => {
    configureSecrets(dataDir);
    const ciphertext = encrypt("secret-value");

    const otherDir = mkdtempSync(path.join(os.tmpdir(), "discoveree-secrets-other-"));
    try {
      resetSecrets();
      configureSecrets(otherDir);
      expect(() => decrypt(ciphertext)).toThrow();
      expect(maskApiKey(ciphertext)).toBe("****");
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
