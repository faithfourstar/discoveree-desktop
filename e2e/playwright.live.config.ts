import { defineConfig, devices } from "@playwright/test";

/**
 * The "live" project: the REAL desktop server (tsx server/main.ts via
 * live/server-entry.mts, which points DISCOVEREE_DATA_DIR at a scratch
 * directory it wipes on start, and binds DISCOVEREE_PORT 7411 — never the
 * real 7317) plus a `vite preview` of the client with its /api proxy aimed
 * at that port (DISCOVEREE_API_URL — see client/vite.config.ts).
 *
 * No LLM keys are configured, deliberately: the suite walks the HONEST
 * states — day-one prompts, save-unverified competitors, feedback kept word
 * for word, keyless settings. Playwright owns both child processes and
 * kills them on teardown; the scratch data dir lives under e2e/.tmp/
 * (gitignored) and is recreated fresh by server-entry on every run.
 */
export default defineConfig({
  testDir: "./live",
  outputDir: "./.artifacts/live-results",
  // One walk, in order — the steps build on each other's data.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 90_000,
  reporter: process.env["CI"]
    ? [["list"], ["html", { outputFolder: "./.artifacts/live-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4518",
    trace: "retain-on-failure",
  },
  projects: [{ name: "live", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx e2e/live/server-entry.mts",
      url: "http://127.0.0.1:7411/api/products",
      cwd: "..",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        "npm --prefix client run build && npm --prefix client run preview -- --port 4518 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:4518",
      cwd: "..",
      env: { DISCOVEREE_API_URL: "http://127.0.0.1:7411" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
