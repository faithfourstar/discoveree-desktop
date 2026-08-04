import { defineConfig, devices } from "@playwright/test";

/**
 * The "mock" project: fully deterministic, no server, no keys. Serves a
 * production build via `vite preview` (chosen over `vite dev`: no on-demand
 * transform or HMR websocket flakiness, it starts in ~4 s including the
 * build, and it exercises the artefact that actually ships) and drives the
 * `?state=` harness datasets.
 *
 * Assertions are on real user-facing copy (British English) — the suite
 * doubles as a copy regression net.
 */
export default defineConfig({
  testDir: "./mock",
  outputDir: "./.artifacts/mock-results",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { outputFolder: "./.artifacts/mock-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4517",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mock", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm --prefix client run build && npm --prefix client run preview -- --port 4517 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4517",
    cwd: "..",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
