import { useLocation } from "wouter";

/**
 * Product-scoped URL helpers (ADR 003 §1.2): the active product is URL
 * state, nothing else — routes carry a `/p/:productId` prefix and the
 * switcher rewrites it. No "current product" lives in localStorage or in a
 * context provider divorced from the URL.
 */

const PRODUCT_PREFIX = /^\/p\/([^/]+)/;

/** `/p/<id>` — the URL prefix for a product's pages. */
export function productBase(productId: string): string {
  return `/p/${encodeURIComponent(productId)}`;
}

/** The product id carried by a location, or null when it has none. */
export function parseProductId(location: string): string | null {
  const match = PRODUCT_PREFIX.exec(location);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The path beneath the product prefix, e.g. "/competitors/mixpanel". */
export function productSubpath(location: string): string {
  const match = PRODUCT_PREFIX.exec(location);
  if (!match) {
    return location;
  }
  const rest = location.slice(match[0].length);
  return rest === "" ? "/" : rest;
}

/**
 * Where switching products lands: the same module, its overview — never a
 * deeper object path, whose ids belong to the product being left.
 */
export function switchProductLocation(
  location: string,
  productId: string,
): string {
  const sub = productSubpath(location);
  const moduleSegment = /^\/([^/]+)/.exec(sub)?.[1];
  return moduleSegment
    ? `${productBase(productId)}/${moduleSegment}`
    : productBase(productId);
}

/** Active product id from the current location. */
export function useActiveProductId(): string | null {
  const [location] = useLocation();
  return parseProductId(location);
}

/**
 * Builds product-scoped hrefs for the active product. Outside a product
 * context (e.g. /products/new) paths pass through bare — the URL guard
 * prefixes them with the first product.
 */
export function useProductHref(): (path: string) => string {
  const productId = useActiveProductId();
  return (path: string) => {
    if (!productId) {
      return path;
    }
    return path === "/" ? productBase(productId) : `${productBase(productId)}${path}`;
  };
}
