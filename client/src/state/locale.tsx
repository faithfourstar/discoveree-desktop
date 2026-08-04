import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  detectDisplayLocale,
  isDisplayLocaleSetting,
  resolveDisplayLocale,
  setActiveDisplayLocale,
  toDisplayEnglish,
  type DisplayLocale,
  type DisplayLocaleSetting,
} from "@/lib/locale";

/**
 * Display-locale context: resolves navigator.language on boot (en-GB for
 * UK/IE/Commonwealth regions, en-US otherwise), honours the Settings
 * override (Auto / British English / American English) persisted via
 * GET/PUT /api/settings/preferences, and exposes `useT()` — the render-time
 * copy transform every user-facing string flows through.
 *
 * Dev override: `?locale=en-GB|en-US` forces the render (latched for the
 * session, like the mock harness's `?state=`) — both renders inspectable.
 *
 * Persistence is server-first with a localStorage fallback, so the mock
 * harness (no server) keeps a working Language control.
 */

const STORAGE_KEY = "discoveree-display-locale";

interface LocaleContextValue {
  /** The locale the app is rendering right now. */
  locale: DisplayLocale;
  setting: DisplayLocaleSetting;
  detected: DisplayLocale;
  /** True when ?locale= is forcing the render (Settings control disabled). */
  overridden: boolean;
  setSetting: (setting: DisplayLocaleSetting) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en-GB",
  setting: "auto",
  detected: "en-GB",
  overridden: false,
  setSetting: () => undefined,
});

function queryOverride(): DisplayLocale | null {
  const value = new URLSearchParams(window.location.search).get("locale");
  return value === "en-GB" || value === "en-US" ? value : null;
}

/** In-app navigation drops query params — the override latches per session. */
let latchedOverride: DisplayLocale | null = null;

function storedSetting(): DisplayLocaleSetting {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isDisplayLocaleSetting(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [override] = useState<DisplayLocale | null>(() => {
    const value = queryOverride() ?? latchedOverride;
    latchedOverride = value;
    return value;
  });
  const [setting, setSettingState] = useState<DisplayLocaleSetting>(
    storedSetting,
  );
  const detected = useMemo(
    () =>
      detectDisplayLocale(
        navigator.languages && navigator.languages.length > 0
          ? navigator.languages
          : [navigator.language],
      ),
    [],
  );

  const locale = override ?? resolveDisplayLocale(setting, detected);
  // Render-time, before children render: date formatters and copy in this
  // pass already see the resolved locale.
  setActiveDisplayLocale(locale);

  // Reconcile with the server preference (live mode). The mock harness has
  // no server — the fetch fails quietly and localStorage stands.
  useEffect(() => {
    let cancelled = false;
    void api
      .getPreferences()
      .then((res) => {
        if (!cancelled && isDisplayLocaleSetting(res.displayLocale)) {
          setSettingState(res.displayLocale);
        }
      })
      .catch(() => {
        // No preferences endpoint reachable — localStorage remains truth.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSetting = useCallback((next: DisplayLocaleSetting) => {
    setSettingState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the in-memory setting still applies.
    }
    void api.putPreferences({ displayLocale: next }).catch(() => {
      // Server unreachable — localStorage carries the preference.
    });
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setting,
      detected,
      overridden: override !== null,
      setSetting,
    }),
    [locale, setting, detected, override, setSetting],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useDisplayLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/**
 * The copy transform hook — route APP COPY through the returned function at
 * render time. Never route data (mined verbatims, agent-stored content,
 * object names) through it; see lib/locale.ts for the boundary.
 */
export function useT(): (copy: string) => string {
  const { locale } = useContext(LocaleContext);
  return useCallback((copy: string) => toDisplayEnglish(copy, locale), [
    locale,
  ]);
}
