/**
 * One resolver for the API/MCP port so main.ts (listen) and the Settings
 * about block (display) can never drift. Default 7317 — the number already
 * in the client footer ("MCP serving :7317").
 */
export const DEFAULT_SERVER_PORT = 7317;

export function resolveServerPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["DISCOVEREE_PORT"];
  if (!raw) return DEFAULT_SERVER_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_SERVER_PORT;
}
