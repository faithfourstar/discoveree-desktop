/**
 * Carved product storage (ADR 002 §3 — minimal in sprint 2: the one product
 * row competitors hang off). Bodies verbatim from the SaaS DatabaseStorage
 * (storage.ts line refs in doc comments).
 */
import { eq } from "drizzle-orm";
import { products, type Product } from "@shared/schema";
import { getDb } from "../../db/index.js";

// drizzle's native insert type — the drizzle-zod InsertProduct type widens jsonb
// columns to Json, which drizzle's typed insert/update rejects under strict tsc.
type ProductInsert = typeof products.$inferInsert;

/** storage.ts:1216 */
export async function getProduct(id: string): Promise<Product | undefined> {
  const db = getDb();
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product || undefined;
}

/** storage.ts:1221 */
export async function getProductsByOrganization(organizationId: string): Promise<Product[]> {
  const db = getDb();
  return await db
    .select()
    .from(products)
    .where(eq(products.organizationId, organizationId));
}

/** storage.ts:1228 */
export async function getAllProducts(): Promise<Product[]> {
  const db = getDb();
  return await db.select().from(products);
}

/** storage.ts:1266 — slug-conflict retry loop kept verbatim. */
export async function createProduct(insertProduct: ProductInsert): Promise<Product> {
  const db = getDb();
  const MAX_SLUG_RETRIES = 10;
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= MAX_SLUG_RETRIES) {
    try {
      let values = insertProduct;
      if (attempt > 0 && insertProduct.slug) {
        const suffix = attempt < MAX_SLUG_RETRIES
          ? `-${attempt + 1}`
          : `-${Math.random().toString(36).slice(2, 8)}`;
        values = { ...insertProduct, slug: `${insertProduct.slug}${suffix}` };
      }
      const [product] = await db
        .insert(products)
        .values(values)
        .returning();
      return product!;
    } catch (err) {
      const e = err as { code?: string; constraint?: string; detail?: string };
      const isSlugConflict =
        e?.code === "23505" &&
        (e?.constraint === "products_slug_unique" || e?.detail?.includes("slug"));
      if (!isSlugConflict) throw err;
      lastError = err;
      attempt++;
    }
  }
  throw lastError;
}

/** storage.ts:1296 */
export async function updateProduct(id: string, updateData: Partial<ProductInsert>): Promise<Product> {
  const db = getDb();
  const [product] = await db
    .update(products)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return product!;
}
