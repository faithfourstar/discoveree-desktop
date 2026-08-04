/**
 * Settings LLM-keys API (sprint 3a minimal surface): masked responses only
 * (never raw keys), encryption round-trip through lib/secrets into the
 * organisations key columns, and the one-cheap-call key validation endpoint
 * with a stubbed fetch.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildApp } from "../../../app.js";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { resetSecrets, setEncryptionKeySource } from "../../../lib/secrets.js";
import { getDecryptedOrgKeys, getOrganization } from "../../../lib/llm/keys.js";

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
  it("Given a provider accepts the key, When tested, Then { ok: true } — exactly one call is made", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "openai", apiKey: OPENAI_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it("Given the provider rejects the key (401), When tested, Then { ok: false } with a clear message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorised", { status: 401 })));

    const res = await request(app)
      .post("/api/settings/llm-keys/test")
      .send({ provider: "claude", apiKey: "sk-ant-wrong" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/rejected this key/i);
  });

  it("Given no apiKey in the body, When tested, Then the STORED key is used (decrypted server-side)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // openai key was stored (encrypted) in the PUT test above
    const res = await request(app).post("/api/settings/llm-keys/test").send({ provider: "openai" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
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
    expect(res.body.error).toMatch(/could not reach/i);
  });
});
