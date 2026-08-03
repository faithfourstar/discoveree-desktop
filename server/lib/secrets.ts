/**
 * Local secrets: encryption-key material + cipher (ADR 002 §4).
 *
 * The cipher (AES-256-GCM, `iv:tag:ciphertext` hex format, maskApiKey) is
 * ported verbatim from the SaaS `server/crypto.ts` so decrypt/mask logic and
 * any future solo→team key migration port intact. What changes is the KEY
 * SOURCE: the SaaS read `process.env.ENCRYPTION_KEY`; desktop generates a
 * per-install `secret.key` file (32 random bytes, mode 0600) beside the
 * database on first run.
 *
 * Plain Node only — the headless MCP CLI must decrypt keys with no shell
 * present. When the desktop shell lands (build step 7), this module upgrades
 * to Electron `safeStorage` / Tauri keyring BEHIND `setEncryptionKeySource()`
 * — callers of encrypt()/decrypt() never change.
 *
 * Honesty note (SECURITY.md, not marketing): a key file beside the database
 * protects against casual file copying, not against a local attacker — the
 * same model as most desktop tools' token stores.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export const SECRET_KEY_FILE_NAME = "secret.key";

/** A source of raw key material (hex string). The seam for the OS-keychain upgrade. */
export type EncryptionKeySource = () => string;

let keySource: EncryptionKeySource | null = null;
let cachedKey: Buffer | null = null;

/**
 * Default file-backed source: read `<dataDir>/secret.key`, creating it with
 * 32 random bytes (hex-encoded) and mode 0600 on first run.
 */
export function fileEncryptionKeySource(dataDir: string): EncryptionKeySource {
  return () => {
    const keyPath = path.join(dataDir, SECRET_KEY_FILE_NAME);
    try {
      return fs.readFileSync(keyPath, "utf8").trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const material = crypto.randomBytes(32).toString("hex");
    // wx: fail rather than overwrite if another process won the race, then re-read.
    try {
      fs.writeFileSync(keyPath, `${material}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return material;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return fs.readFileSync(keyPath, "utf8").trim();
      }
      throw err;
    }
  };
}

/**
 * Configure where key material comes from. Entry points call
 * `configureSecrets(dataDir)`; tests and (later) the shell may install a
 * custom source via `setEncryptionKeySource()`.
 */
export function configureSecrets(dataDir: string): void {
  setEncryptionKeySource(fileEncryptionKeySource(dataDir));
}

export function setEncryptionKeySource(source: EncryptionKeySource): void {
  keySource = source;
  cachedKey = null;
}

/** Test/shutdown helper. */
export function resetSecrets(): void {
  keySource = null;
  cachedKey = null;
}

/**
 * SHA-256 of the raw material, exactly as the SaaS derived its key from
 * ENCRYPTION_KEY — keeps the ciphertext format and any migration path intact.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (!keySource) {
    throw new Error(
      "Secrets not configured — call configureSecrets(dataDir) before using encrypt()/decrypt().",
    );
  }
  const material = keySource();
  if (!material) {
    throw new Error("Encryption key material is empty — secret.key may be corrupt.");
  }
  cachedKey = crypto.createHash("sha256").update(material).digest();
  return cachedKey;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const iv = Buffer.from(parts[0]!, "hex");
  const tag = Buffer.from(parts[1]!, "hex");
  const encrypted = parts[2]!;

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;

  try {
    const decrypted = decrypt(key);
    if (decrypted.length <= 8) {
      return "****";
    }
    return decrypted.substring(0, 4) + "..." + decrypted.substring(decrypted.length - 4);
  } catch {
    return "****";
  }
}
