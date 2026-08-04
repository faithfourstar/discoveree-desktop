/**
 * productContext middleware (ADR 003 §1.1) — sibling of localIdentity.
 *
 * Resolves the explicit `:productId` path segment on
 * /api/products/:productId/... routes, verifies the product belongs to
 * req.ctx.organizationId, and sets req.ctx.productId + req.product. Handlers
 * never call `products[0]` — that convention is deleted, not deprecated.
 *
 * In team mode this middleware is where the per-user product-access predicate
 * lands (ADR 003 §4) — one check in one place, the payoff of explicit route
 * scoping.
 */
import type { NextFunction, Request, Response } from "express";
import type { Product } from "@shared/schema";
import { getProduct } from "../modules/products/storage.js";
import { NotFoundError } from "./errors.js";

declare module "express-serve-static-core" {
  interface Request {
    /** The resolved product row for /api/products/:productId routes. */
    product?: Product;
  }
}

export function productContext(req: Request, _res: Response, next: NextFunction): void {
  (async () => {
    const productId = req.params["productId"];
    if (!productId) {
      throw new NotFoundError("Product not found");
    }
    const product = await getProduct(productId);
    if (!product || product.organizationId !== req.ctx.organizationId) {
      // 404 (not 403): outside the org the product does not exist.
      throw new NotFoundError("Product not found");
    }
    req.ctx.productId = product.id;
    req.product = product;
    next();
  })().catch(next);
}

/** Typed accessor for handlers mounted behind productContext. */
export function requireProductFromRequest(req: Request): Product {
  if (!req.product) {
    throw new Error("productContext middleware did not run for this route");
  }
  return req.product;
}
