/**
 * Settings LLM-keys API (sprint 3a minimal surface): masked responses only
 * (never raw keys), encryption round-trip through lib/secrets into the
 * organisations key columns, and the one-cheap-call key validation endpoint
 * with a stubbed fetch.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildApp } from "../../../app.js";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { resetSecrets, setEncryptionKeySource } from "../../../lib/secrets.js";
import { getDecryptedOrgKeys, getOrganization } from "../../../lib/llm/keys.js";
import { sanitiseProviderDetail } from "../service.js";

let app: Express;

const OPENAI_KEY = "sk-test-1234567890abcdef";
const CLAUDE_KEY = "sk-ant-test-abcdef1234567890";

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  setEncryptionKeySource(() => "test-key-material");
  app = buildApp();
});

afterAll(async () => {
  resetSecrets();
  await closeDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/settings/llm-keys", () => {
  it("Given no stored keys, When read, Then every key is null and the mode is individual", async () => {
    const res = await request(app).get("/api/settings/llm-keys");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keys: { openai: null, gemini: null, perplexity: null, claude: null, openrouter: null },
      llmKeyMode: "individual",
    });
  });
});

describe("PUT /api/settings/llm-keys", () => {
  it("Given plaintext keys, When stored, Then the DB holds ciphertext, decryption round-trips, and responses are masked", async () => {
    const res = await request(app)
      .put("/api/settings/llm-keys")
      .send({ openaiApiKey: OPENAI_KEY, claudeApiKey: CLAUDE_KEY });
    expect(res.status).toBe(200);

    // Masked, never raw: first 4 + "..." + last 4 (maskApiKey contract)
    expect(res.body.keys.openai).toBe(`${OPENAI_KEY.slice(0, 4)}...${OPENAI_KEY.slice(-4)}`);
    expect(res.body.keys.claude).toBe(`${CLAUDE_KEY.slice(0, 4)}...${CLAUDE_KEY.slice(-4)}`);
    expect(res.body.keys.openai).not.toContain(OPENAI_KEY.slice(4, -4));
    expect(res.body.keys.gemini).toBeNull();

    // Encrypted at rest: the stored column is iv:tag:ciphertext hex, not the key
    const org = await getOrganization(LOCAL_ORGANIZATION_ID);
    expect(org!.openaiApiKey).not.toContain(OPENAI_KEY);
    expect(org!.openaiApiKey!.split(":")).toHaveLength(3);

    // Round-trip: the router's key reader decrypts back to the plaintext
    const decrypted = await getDecryptedOrgKeys(LOCAL_ORGANIZATION_ID);
    expect(decrypted.openai).toBe(OPENAI_KEY);
    expect(decrypted.claude).toBe(CLAUDE_KEY);

    // GET serves the same masked view — raw keys never leave the server
    const get = await request(app).get("/api/settings/llm-keys");
    expect(get.body.keys.openai).toBe(res.body.keys.openai);
    expect(JSON.stringify(get.body)).not.toContain(OPENAI_KEY);
  });

  it("omitted fields are unchanged; null clears a key; the mode can switch", async () => {
    const res = await request(app)
      .put("/api/settings/llm-keys")
      .send({ claudeApiKey: null, llmKeyMode: "openrouter" });
    expect(res.status).toBe(200);
    expect(res.body.keys.claude).toBeNull(); // cleared
    expect(res.body.keys.openai).toBeTruthy(); // untouched
    expect(res.body.llmKeyMode).toBe("openrouter");

    const back = await request(app).put("/api/settings/llm-keys").send({ llmKeyMode: "individual" });
    expect(back.body.llmKeyMode).toBe("individual");
  });

  it("an empty body → 400", async () => {
    const res = await request(app).put("/api/settings/llm-keys").send({});
    expect(res.status).toBe(400);
  });

  it("an empty-string key → 400 (Zod), not a stored empty secret", async () => {
    const res = await request(app).put("/api/settings/llm-keys").send({ geminiApiKey: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/settings/llm-keys/test", () => {
  it("Given a provider accepts the key, When tested, Then { ok, verdict: valid } — exactly one call is made", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "openai", apiKey: OPENAI_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, verdict: "valid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it("Given the provider rejects the key (401), When tested, Then verdict is rejected with a clear message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorised", { status: 401 })));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "claude", apiKey: "sk-ant-wrong" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.verdict).toBe("rejected");
    expect(res.body.error).toMatch(/rejected this key/i);
    // Rejected verdicts carry the provider's own words as supplementary detail.
    expect(res.body.detail).toBe("unauthorised");
  });

  it("Given a Google 403 with google.rpc details, When tested, Then rejected carries the message AND the reason code in detail", async () => {
    // Live-user case #2: a fresh valid key with the Generative Language API
    // not yet enabled — the flat "rejected" line hides the actionable reason.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        error: {
          code: 403,
          message: "Generative Language API has not been used in project 12345 before or it is disabled.",
          status: "PERMISSION_DENIED",
          details: [
            { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com" },
          ],
        },
      }),
      { status: 403 },
    )));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "gemini", apiKey: "AIzaSyOwnerKey123456" });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("rejected");
    expect(res.body.error).toMatch(/rejected this key/i); // user line stays flat
    expect(res.body.detail).toBe(
      "Generative Language API has not been used in project 12345 before or it is disabled. (SERVICE_DISABLED)",
    );
  });

  it("Given Google's 400 for a malformed key, When tested, Then the special-case rejected path carries detail and still redacts key shapes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: "API key not valid: AIzaSyOwnerKey123456. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      }),
      { status: 400 },
    )));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "gemini", apiKey: "AIzaSyOwnerKey123456" });
    expect(res.body.verdict).toBe("rejected");
    expect(res.body.detail).toContain("(API_KEY_INVALID)");
    expect(JSON.stringify(res.body)).not.toContain("AIzaSyOwnerKey123456");
    expect(res.body.detail).toContain("[redacted]");
  });

  it("The Perplexity test call respects the documented parameter floor (max_tokens ≥ 16)", async () => {
    // Regression pin for the live-user bug: max_tokens: 1 drew
    // 400 "max_tokens must be at least 16" for a VALID key.
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "perplexity", apiKey: "pplx-valid-key-1234567890" });
    expect(res.body).toEqual({ ok: true, verdict: "valid" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.perplexity.ai/chat/completions");
    const body = JSON.parse(init.body as string) as { model: string; max_tokens: number };
    expect(body.model).toBe("sonar");
    expect(body.max_tokens).toBeGreaterThanOrEqual(16);
  });

  it("Given a non-auth provider error (Perplexity 400), When tested, Then verdict is provider-error with the provider's sanitised message", async () => {
    // The live-user case: a fresh valid key answered 400 by the sonar test
    // call. The response must name the provider, carry its actual message,
    // and never claim a verdict on the key.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Invalid model 'sonar'.", type: "invalid_request_error" } }),
      { status: 400 },
    )));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "perplexity", apiKey: "pplx-valid-key-1234567890" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.verdict).toBe("provider-error");
    expect(res.body.detail).toBe("Invalid model 'sonar'.");
    expect(res.body.error).toBe("Perplexity answered with an error — Invalid model 'sonar'.");
  });

  it("Given a provider error body that echoes an API key, When tested, Then the key never passes through detail or error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Bad request for key pplx-valid-key-1234567890 with Bearer abc123456789 attached" } }),
      { status: 400 },
    )));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "perplexity", apiKey: "pplx-valid-key-1234567890" });
    expect(res.body.verdict).toBe("provider-error");
    expect(JSON.stringify(res.body)).not.toContain("pplx-valid-key-1234567890");
    expect(JSON.stringify(res.body)).not.toContain("abc123456789");
    expect(res.body.detail).toContain("[redacted]");
  });

  it("Given a timed-out provider, When tested, Then verdict is timeout — never a verdict on the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      throw err;
    }));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "openai", apiKey: OPENAI_KEY });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.verdict).toBe("timeout");
    expect(res.body.error).toMatch(/did not respond in time/i);
  });

  it("Given no apiKey in the body, When tested, Then the STORED key is used (decrypted server-side)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // openai key was stored (encrypted) in the PUT test above
    const res = await request(app).post("/api/settings/llm-keys/test").send({ provider: "openai" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, verdict: "valid" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it("Given neither a body key nor a stored key, When tested, Then 400", async () => {
    const res = await request(app).post("/api/settings/llm-keys/test").send({ provider: "perplexity" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no stored key/i);
  });

  it("Given an unreachable provider, When tested, Then { ok: false } with a connection message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "gemini", apiKey: "AItest123" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.verdict).toBe("network");
    expect(res.body.error).toMatch(/could not reach/i);
  });
});

describe("sanitiseProviderDetail", () => {
  it("prefers the JSON error message, redacts key shapes, collapses whitespace and truncates to ~200 chars", () => {
    expect(sanitiseProviderDetail(JSON.stringify({ error: { message: "Out of credits." } }))).toBe("Out of credits.");
    // google.rpc reasons append to the message; duplicates collapse; reasons
    // alone still surface when Google sends no message.
    expect(sanitiseProviderDetail(JSON.stringify({
      error: { message: "Requests blocked.", details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }, { reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] },
    }))).toBe("Requests blocked. (API_KEY_HTTP_REFERRER_BLOCKED)");
    expect(sanitiseProviderDetail(JSON.stringify({
      error: { details: [{ reason: "SERVICE_DISABLED" }] },
    }))).toBe("SERVICE_DISABLED");
    expect(sanitiseProviderDetail(JSON.stringify({ error: "Plain string error" }))).toBe("Plain string error");
    expect(sanitiseProviderDetail(JSON.stringify({ message: "Top-level message" }))).toBe("Top-level message");
    expect(sanitiseProviderDetail("not json\n  at all")).toBe("not json at all");
    expect(sanitiseProviderDetail("key sk-ant-abcdef123456 leaked")).toBe("key [redacted] leaked");
    expect(sanitiseProviderDetail("token AIzaSyABCDEF12345 leaked")).toBe("token [redacted] leaked");
    expect(sanitiseProviderDetail("")).toBeUndefined();
    expect(sanitiseProviderDetail(null)).toBeUndefined();

    const long = sanitiseProviderDetail("x".repeat(500));
    expect(long).toHaveLength(201); // 200 chars + ellipsis
    expect(long!.endsWith("…")).toBe(true);
  });
});

describe("GET /api/settings/about", () => {
  it("returns the data dir, on-disk DB size, package.json version and server port", async () => {
    // Point the data dir at a scratch directory with a known db/ payload so
    // dbSizeBytes is deterministic (the running test DB itself is memory://).
    const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "discoveree-about-"));
    await fs.mkdir(path.join(scratchDir, "db", "nested"), { recursive: true });
    await fs.writeFile(path.join(scratchDir, "db", "base"), Buffer.alloc(1024));
    await fs.writeFile(path.join(scratchDir, "db", "nested", "wal"), Buffer.alloc(512));
    vi.stubEnv("DISCOVEREE_DATA_DIR", scratchDir);
    vi.stubEnv("DISCOVEREE_PORT", "");

    try {
      const res = await request(app).get("/api/settings/about");
      expect(res.status).toBe(200);
      expect(res.body.dataDir).toBe(path.resolve(scratchDir));
      expect(res.body.dbSizeBytes).toBe(1536); // recursive: 1024 + 512
      expect(res.body.serverPort).toBe(7317); // the footer's "MCP serving :7317"

      const packageJson = JSON.parse(await fs.readFile(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../package.json"),
        "utf8",
      )) as { version: string };
      expect(res.body.appVersion).toBe(packageJson.version);
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("a missing database directory reports 0 bytes, not an error", async () => {
    const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "discoveree-about-empty-"));
    vi.stubEnv("DISCOVEREE_DATA_DIR", scratchDir);
    try {
      const res = await request(app).get("/api/settings/about");
      expect(res.status).toBe(200);
      expect(res.body.dbSizeBytes).toBe(0);
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  });
});
