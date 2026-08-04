/**
 * Products API — the collection surface (ADR 003 §1.1). Replaces the sprint-2
 * singular GET/PATCH /api/product: multi-product is now surface-possible, and
 * the client's onboarding PATCH-to-create becomes POST /api/products.
 *
 *   GET    /api/products              → { products: ProductView[] }
 *   POST   /api/products              → 201 { product }
 *   GET    /api/products/:productId   → { product }
 *   PATCH  /api/products/:productId   → { product }
 */
import type { Express } from "express";
import { Router } from "express";
import { z } from "zod/v4";
import type { Product } from "@shared/schema";
import { asyncHandler } from "../../http/asyncHandler.js";
import { NotFoundError } from "../../http/errors.js";
import { createProduct, getProduct, getProductsByOrganization, updateProduct } from "./storage.js";

const productBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().url().nullish(),
  description: z.string().trim().max(5000).nullish(),
});

const createProductBodySchema = productBodySchema.extend({
  name: z.string().trim().min(1, "A product name is required to create a product.").max(200),
});

export interface ProductView {
  id: string;
  name: string;
  slug: string | null;
  url: string | null;
  description: string | null;
}

export function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug ?? null,
    url: product.url ?? null,
    description: product.description ?? null,
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";
}

async function requireProductInOrg(organizationId: string, id: string): Promise<Product> {
  const product = await getProduct(id);
  if (!product || product.organizationId !== organizationId) {
    throw new NotFoundError("Product not found");
  }
  return product;
}

export function registerProductRoutes(app: Express): void {
  const router = Router();

  router.get("/products", asyncHandler(async (req, res) => {
    const products = await getProductsByOrganization(req.ctx.organizationId);
    res.json({ products: products.map(toProductView) });
  }));

  router.post("/products", asyncHandler(async (req, res) => {
    const body = createProductBodySchema.parse(req.body);
    const created = await createProduct({
      organizationId: req.ctx.organizationId,
      name: body.name,
      slug: slugify(body.name),
      url: body.url ?? null,
      description: body.description ?? null,
    });
    res.status(201).json({ product: toProductView(created) });
  }));

  router.get("/products/:productId", asyncHandler(async (req, res) => {
    const product = await requireProductInOrg(req.ctx.organizationId, req.params["productId"]!);
    res.json({ product: toProductView(product) });
  }));

  router.patch("/products/:productId", asyncHandler(async (req, res) => {
    const body = productBodySchema.parse(req.body);
    const existing = await requireProductInOrg(req.ctx.organizationId, req.params["productId"]!);
    const updated = await updateProduct(existing.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
    res.json({ product: toProductView(updated) });
  }));

  app.use("/api", router);
}
