/**
 * The auth seam (ADR 002 §2): `localIdentity` attaches the fixed local ids
 * from the desktop seed to every /api request. In team mode the same slot
 * holds the real auth middleware; handlers are already written against
 * `req.ctx.organizationId` so nothing changes at the seam.
 *
 * This is the ONLY app-code module allowed to import the seed constants
 * (module storage takes explicit ids).
 */
import type { NextFunction, Request, Response } from "express";
import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "../db/seedLocal.js";

export interface RequestCtx {
  organizationId: string;
  userId: string;
  /**
   * Set by the productContext middleware (ADR 003 §1.1) on
   * /api/products/:productId routes; absent on org-scoped routes.
   */
  productId?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    ctx: RequestCtx;
  }
}

export function localIdentity(req: Request, _res: Response, next: NextFunction): void {
  req.ctx = {
    organizationId: LOCAL_ORGANIZATION_ID,
    userId: LOCAL_USER_ID,
  };
  next();
}
