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

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", localIdentity);
  registerProductRoutes(app);
  registerCompetitorRoutes(app);
  app.use("/api", notFoundHandler); // unknown /api/* → 404 JSON, never the SPA
  app.use(errorMiddleware);
  return app;
}
