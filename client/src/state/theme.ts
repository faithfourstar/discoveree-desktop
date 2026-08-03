import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "discoveree-theme";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(STORAGE_KEY, theme);
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Light/dark theme with pre-paint initialisation handled in index.html. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme);
  const toggleTheme = useCallback(() => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  }, []);
  return { theme, toggleTheme };
}
