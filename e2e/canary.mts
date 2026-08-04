/**
 * Provider canary: runs the product's OWN key-test code (testProviderKey in
 * server/modules/settings/service.ts) against real keys held in GitHub
 * secrets — so provider drift that would hit customers (endpoint renames,
 * parameter floors like Perplexity's max_tokens ≥ 16, auth scheme changes)
 * fails our nightly job before it fails a customer.
 *
 * Per provider: no secret → skipped with a notice; verdict "valid" → pass;
 * "rejected" → fail with "check the canary key" (the key, not the provider);
 * anything else (provider-error / network / timeout) → fail with the served
 * detail — that is the drift signal.
 *
 * Exit code 1 on any failure; GitHub's normal workflow-failure notification
 * reaches the repo owner. Secret names are documented in docs/testing.md.
 */
import {
  LLM_KEY_PROVIDERS,
  testProviderKey,
  type LlmKeyProvider,
} from "../server/modules/settings/service.js";

const SECRET_NAMES: Record<LlmKeyProvider, string> = {
  openai: "CANARY_OPENAI_KEY",
  gemini: "CANARY_GEMINI_KEY",
  perplexity: "CANARY_PERPLEXITY_KEY",
  claude: "CANARY_CLAUDE_KEY",
  openrouter: "CANARY_OPENROUTER_KEY",
};

let tested = 0;
let failures = 0;

for (const provider of LLM_KEY_PROVIDERS) {
  const secretName = SECRET_NAMES[provider];
  const key = process.env[secretName];
  if (!key) {
    console.log(`::notice title=Canary skipped::${provider}: no ${secretName} secret configured — skipped.`);
    continue;
  }
  tested += 1;
  const result = await testProviderKey(provider, key);
  if (result.verdict === "valid") {
    console.log(`${provider}: valid`);
    continue;
  }
  failures += 1;
  if (result.verdict === "rejected") {
    console.log(
      `::error title=Canary key problem::${provider}: the provider rejected the canary key — ` +
      `check or rotate the ${secretName} secret.${result.detail ? ` Provider said: ${result.detail}` : ""}`,
    );
  } else {
    // provider-error / network / timeout — no verdict on the key; this is
    // the drift (or outage) signal the canary exists for.
    console.log(
      `::error title=Provider drift signal::${provider}: ${result.verdict} — ${result.error ?? "no message"}` +
      `${result.detail ? ` Provider said: ${result.detail}` : ""}`,
    );
  }
}

if (tested === 0) {
  console.log("::notice title=Canary idle::No canary keys configured — nothing was tested.");
}
console.log(`Canary complete — ${tested} provider(s) tested, ${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
