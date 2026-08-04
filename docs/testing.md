# Testing

Four layers, each answering a different question:

| Layer | Question | Command | Runs |
|---|---|---|---|
| Typecheck | Does it compile cleanly? | `npm run check` | Every push/PR |
| Unit/integration (Vitest) | Does each module behave? | `npm test` | Every push/PR |
| E2E — mock project (Playwright) | Does the UI render the specified states and copy? | `npm run test:e2e` | Every push/PR |
| E2E — live project (Playwright) | Does the real server + real client walk the honest states? | `npm run test:e2e:live` | Nightly + manual |
| Provider canary | Have the LLM providers drifted under us? | `npm run canary` | Nightly + manual |

## E2E suite (`e2e/`)

Both projects serve a **production build** via `vite preview` (chosen over
`vite dev`: no on-demand-transform or HMR flakiness, starts in ~4 s
including the build, and it exercises the artefact that ships). Only
Chromium is installed (`npx playwright install chromium`). Assertions are
on real user-facing copy — British English, curly apostrophes included — so
the suite doubles as a copy regression net.

### The mock project — `npm run test:e2e`

- Config: `e2e/playwright.mock.config.ts` · specs: `e2e/mock/*.spec.ts`.
- Fully deterministic: **no server, no database, no keys** — it drives the
  client's `?state=` harness datasets (see `client/src/state/AppStateContext.tsx`).
- Preview on `127.0.0.1:4517`.
- Walks: home briefing and day-one prompt; competitors overview with the
  cards ↔ table view toggle; the competitor object with its deep-dive
  thread; customers overview bands, the unfiled line and a theme's verbatim
  evidence; settings blocks with the masked-key contract and the keyless
  amber state.

### The live project — `npm run test:e2e:live`

- Config: `e2e/playwright.live.config.ts` · spec: `e2e/live/honest-states.spec.ts`.
- Boots the **real desktop server** through `e2e/live/server-entry.mts`,
  which wipes and recreates a scratch data directory (`e2e/.tmp/live-data`,
  gitignored) and binds `DISCOVEREE_PORT=7411` — never the real 7317, so a
  running dev instance is untouched. The client preview on `127.0.0.1:4518`
  proxies `/api` there via `DISCOVEREE_API_URL` (see `client/vite.config.ts`).
- **No LLM keys, deliberately** — the walk asserts the honest keyless
  states: product created via API → competitors day-one prompt; competitor
  created + accepted via API → save-unverified row with the failure grammar
  and its remedy; feedback logged through the UI → "Filed word for word",
  then the honest settle line and the unfiled count; settings → five
  keyless provider rows and the amber consequence lede.
- Playwright owns both child processes and kills them on teardown; the
  scratch directory is recreated fresh by `server-entry.mts` on every run,
  so nothing leaks between runs or outside `e2e/.tmp/`.

### CI wiring (`.github/workflows/ci.yml`)

- Pushes/PRs: `check` (typecheck + unit tests) then `e2e` running the
  **mock project only** — total e2e cost is well under a minute.
- Nightly (02:23 UTC) and `workflow_dispatch`: the same pipeline plus the
  **live project**.
- Retries: 1 in CI. On failure, Playwright traces and HTML reports upload
  as the `playwright-artifacts` artefact (`e2e/.artifacts/`).

## Provider canary (`.github/workflows/canary.yml`)

`e2e/canary.mts` imports **the product's own key-test code**
(`testProviderKey` in `server/modules/settings/service.ts`) and runs it
against real keys nightly (02:47 UTC) and on manual dispatch — so provider
drift that would hit customers (endpoint renames, parameter floors such as
Perplexity's `max_tokens ≥ 16`, auth changes) fails our job before a
customer sees it.

Per provider:

- **No secret** → skipped with a workflow notice.
- **Verdict `valid`** → pass.
- **Verdict `rejected`** → fail with "check or rotate the canary key" (the
  key is the suspect, not the provider).
- **`provider-error` / `network` / `timeout`** → fail with the provider's
  own sanitised message — that is the drift signal.

A job failure reaches the repository owner through GitHub's normal
workflow-failure notification. Nothing else is wired.

### Canary secrets (optional but recommended)

Add these repository secrets (Settings → Secrets and variables → Actions);
each one you add is one provider the canary covers. Use low-value keys —
each nightly run makes exactly one cheap authenticated call per provider
(metadata lists where the provider has one; a 16-token sonar completion for
Perplexity, fractions of a penny).

| Secret | Provider |
|---|---|
| `CANARY_CLAUDE_KEY` | Anthropic |
| `CANARY_OPENAI_KEY` | OpenAI |
| `CANARY_GEMINI_KEY` | Google |
| `CANARY_PERPLEXITY_KEY` | Perplexity |
| `CANARY_OPENROUTER_KEY` | OpenRouter |

With no secrets configured the job passes idle (a notice per provider) —
adding keys is the owner's call.

## Local prerequisites

```sh
npm ci                # root (server + e2e deps)
npm ci --prefix client
npx playwright install chromium
```
