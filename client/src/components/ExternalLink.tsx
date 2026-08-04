import type { AnchorHTMLAttributes, MouseEvent } from "react";

/**
 * The single home of the external-link contract (the countNoun precedent:
 * one rule, one place). Anything pointing at a URL outside the app renders
 * through this component, which guarantees:
 *
 * - `target="_blank" rel="noopener noreferrer"` — an external link never
 *   navigates the app frame;
 * - scheme-less hrefs (agents sometimes store `example.com/changelog`) are
 *   made absolute, so they can never resolve against the app's own router
 *   and strand the user on the not-found page;
 * - clicks never bubble into row-level navigation (role="link" cards).
 *
 * Desktop packaging note: under Tauri, `target="_blank"` is intercepted and
 * routed to the system browser (shell plugin) — this component is where that
 * contract lives. Do not hand-roll external anchors elsewhere.
 */

/** Absolute form of an external href — bare domains get https://. */
export function externalHref(href: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
}

type ExternalLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> & {
  href: string;
};

export function ExternalLink({ href, onClick, ...rest }: ExternalLinkProps) {
  return (
    <a
      {...rest}
      href={externalHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
}
