/**
 * Payload discipline for the MCP surface (ADR 005 §2.3/§2.4): the `_context`
 * envelope (freshness stamp on every response), the deterministic
 * product-parameter semantics (ADR 003 §1.2 — never a silent products[0]),
 * and the tool error shape.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import type { Product } from "@shared/schema";
import { getProductsByOrganization } from "../modules/products/storage.js";

/** A deterministic, model-parseable tool error (served as an isError result). */
export class McpToolError extends Error {
  constructor(public readonly payload: Record<string, unknown>) {
    super(typeof payload["error"] === "string" ? (payload["error"] as string) : "tool_error");
    this.name = "McpToolError";
  }
}

function productSummary(products: Product[]): Array<{ id: string; slug: string | null; name: string }> {
  return products.map(p => ({ id: p.id, slug: p.slug ?? null, name: p.name }));
}

/**
 * ADR 003 §1.2 semantics: `product` accepts id, slug, or a case-insensitive
 * exact NAME match (a consuming AI naturally passes the name it just read in
 * a previous response — smoke-test ruling, 4 Aug 2026). Omitted + one product
 * → that product; omitted + several → deterministic `product_required` with
 * the list; unknown OR an ambiguous duplicate name → `product_not_found`
 * listing ids/slugs; a pin (CLI --product) defaults the parameter and
 * REFUSES an explicit mismatch (`product_pinned`).
 */
export async function resolveProductParam(
  organizationId: string,
  param: string | undefined,
  pin: string | null,
): Promise<Product> {
  const products = await getProductsByOrganization(organizationId);

  /** id → slug → unambiguous case-insensitive exact name. */
  const find = (value: string): { match: Product | undefined; ambiguousName: boolean } => {
    const exact = products.find(p => p.id === value || p.slug === value);
    if (exact) return { match: exact, ambiguousName: false };
    const nameLower = value.trim().toLowerCase();
    const byName = products.filter(p => p.name.trim().toLowerCase() === nameLower);
    if (byName.length === 1) return { match: byName[0]!, ambiguousName: false };
    return { match: undefined, ambiguousName: byName.length > 1 };
  };

  if (pin) {
    const pinned = find(pin).match;
    if (!pinned) {
      throw new McpToolError({
        error: "product_not_found",
        message: `The pinned product "${pin}" does not exist in this workspace.`,
        products: productSummary(products),
      });
    }
    if (param && find(param).match?.id !== pinned.id) {
      throw new McpToolError({
        error: "product_pinned",
        message: `This connection is pinned to the product "${pinned.name}" — it cannot read a sibling product. Omit the product parameter or pass "${pinned.slug ?? pinned.id}".`,
        product: { id: pinned.id, slug: pinned.slug ?? null, name: pinned.name },
      });
    }
    return pinned;
  }

  if (param) {
    const { match, ambiguousName } = find(param);
    if (!match) {
      throw new McpToolError({
        error: "product_not_found",
        message: ambiguousName
          ? `"${param}" matches more than one product by name. Pass one of the ids or slugs below.`
          : `No product matches "${param}". Pass one of the ids or slugs below.`,
        products: productSummary(products),
      });
    }
    return match;
  }

  if (products.length === 1) return products[0]!;
  if (products.length === 0) {
    throw new McpToolError({
      error: "no_products",
      message: "This workspace has no products yet — create one in Discoveree first.",
      products: [],
    });
  }
  throw new McpToolError({
    error: "product_required",
    message: `This organisation has ${products.length} products — pass product.`,
    products: productSummary(products),
  });
}

/**
 * The envelope (ADR 005 §2.4 property 3): every response carries which
 * product it describes and when it was generated — ISO 8601, never
 * pre-formatted; the consuming model does relative phrasing.
 */
export function withContext<T extends Record<string, unknown>>(
  payload: T,
  product: Product | null,
): T & { _context: Record<string, unknown> } {
  return {
    ...payload,
    _context: {
      ...(product ? { product: { id: product.id, name: product.name, slug: product.slug ?? null } } : {}),
      generatedAt: new Date().toISOString(),
    },
  };
}

/** Clamp a limit parameter into [1, max]. */
export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
