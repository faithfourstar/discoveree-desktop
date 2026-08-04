/**
 * buildApp() — assembles Express from module registrations (ADR 002 §2).
 *
 * - Each module exports one register<Module>Routes(app) using an express
 *   Router. Modules never import each other's routes.
 * - `localIdentity` is the auth seam: it injects the fixed local ids; in team
 *   mode the same slot holds the real auth middleware.
 * - Central error middleware is the only place that writes 500s.
 */
import express from "express";
import { localIdentity } from "./http/identity.js";
import { errorMiddleware, notFoundHandler } from "./http/errors.js";
import { registerProductRoutes } from "./modules/products/routes.js";
import { registerCompetitorRoutes } from "./modules/competitors/routes.js";
import { registerCustomerRoutes } from "./modules/customers/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";
import { mountMcp, type MountMcpOptions } from "./mcp/http.js";

export interface BuildAppOptions {
  /** DNS-rebinding allow-list for the /mcp endpoint (ADR 005 §1.5). */
  mcpAllowedHosts?: MountMcpOptions["allowedHosts"];
}

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", localIdentity);
  registerProductRoutes(app);
  // Mounts the product-scoped surfaces at /api/products/:productId (ADR 003
  // §1.1, productContext middleware) plus the org-level entity reads.
  registerCompetitorRoutes(app);
  registerCustomerRoutes(app);
  registerSettingsRoutes(app);
  // Localhost HTTP MCP (ADR 005 §1.1 in-app mode) — same listener, same port,
  // same identity seam as the API.
  app.use("/mcp", localIdentity);
  mountMcp(app, { allowedHosts: options.mcpAllowedHosts });
  app.use("/api", notFoundHandler); // unknown /api/* → 404 JSON, never the SPA
  app.use(errorMiddleware);
  return app;
}
