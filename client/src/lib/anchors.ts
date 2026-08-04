/**
 * Settings block anchors (settings-spec §0.1): notices elsewhere and the
 * status-footer segments land on a specific block, which gets the standard
 * one-time highlight. Two arrival paths are supported:
 *
 * 1. Plain links carrying a hash (`/p/x/settings#llm-keys`) — the page reads
 *    `window.location.hash` on mount.
 * 2. In-app doors while the page may already be mounted (footer segments) —
 *    a custom event dispatched after navigation commits.
 */

export type SettingsAnchor =
  | "llm-keys"
  | "agent-schedules"
  | "connections"
  | "add-capabilities"
  | "licence"
  | "about";

const SETTINGS_ANCHORS: readonly SettingsAnchor[] = [
  "llm-keys",
  "agent-schedules",
  "connections",
  "add-capabilities",
  "licence",
  "about",
];

export function parseSettingsAnchor(hash: string): SettingsAnchor | null {
  const value = hash.replace(/^#/, "");
  return SETTINGS_ANCHORS.find((anchor) => anchor === value) ?? null;
}

const ANCHOR_EVENT = "discoveree:settings-anchor";

/**
 * Navigate to the Settings page and announce the target block. The event is
 * dispatched after two animation frames so React has committed the page
 * (its listener registers in a layout effect, which runs before paint).
 */
export function goToSettingsBlock(
  navigate: (to: string) => void,
  settingsHref: string,
  anchor: SettingsAnchor,
): void {
  navigate(settingsHref);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<SettingsAnchor>(ANCHOR_EVENT, { detail: anchor }),
      );
    });
  });
}

export function onSettingsAnchor(
  handler: (anchor: SettingsAnchor) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SettingsAnchor>).detail;
    if (detail) {
      handler(detail);
    }
  };
  window.addEventListener(ANCHOR_EVENT, listener);
  return () => window.removeEventListener(ANCHOR_EVENT, listener);
}
