/**
 * Product API — minimal in sprint 2 (ADR 002 §3): the one product row
 * competitors hang off. GET returns it (or null before onboarding);
 * PATCH creates-or-updates it.
 */
import type { Express } from "express";
import { Router } from "express";
import { z } from "zod/v4";
import type { Product } from "@shared/schema";
import { asyncHandler } from "../../http/asyncHandler.js";
import { createProduct, getProductsByOrganization, updateProduct } from "./storage.js";

const patchProductBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().url().nullish(),
  description: z.string().trim().max(5000).nullish(),
});

function toProductView(product: Product): { id: string; name: string; url: string | null; description: string | null } {
  return {
    id: product.id,
    name: product.name,
    url: product.url ?? null,
    description: product.description ?? null,
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";
}

export function registerProductRoutes(app: Express): void {
  const router = Router();

  router.get("/product", asyncHandler(async (req, res) => {
    const [product] = await getProductsByOrganization(req.ctx.organizationId);
    res.json({ product: product ? toProductView(product) : null });
  }));

  router.patch("/product", asyncHandler(async (req, res) => {
    const body = patchProductBodySchema.parse(req.body);
    const [existing] = await getProductsByOrganization(req.ctx.organizationId);

    if (existing) {
      const updated = await updateProduct(existing.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      });
      res.json({ product: toProductView(updated) });
      return;
    }

    const name = body.name?.trim();
    if (!name) {
      res.status(400).json({ error: "A product name is required to create your product profile." });
      return;
    }
    const created = await createProduct({
      organizationId: req.ctx.organizationId,
      name,
      slug: slugify(name),
      url: body.url ?? null,
      description: body.description ?? null,
    });
    res.status(201).json({ product: toProductView(created) });
  }));

  app.use("/api", router);
}
