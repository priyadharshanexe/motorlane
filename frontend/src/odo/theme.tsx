// Night (dark, the default look) and Daytime (light). The choice follows the system until the visitor picks one,
// then it is remembered on this device only. Storage can be unavailable (private windows), so it is optional.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "dark" | "light";
const KEY = "motorlane-theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage blocked: follow the system */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    return () => { document.documentElement.style.colorScheme = ""; };
  }, [theme]);
  const toggle = () => setTheme(current => {
    const next = current === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch { /* not remembered, still applied */ }
    return next;
  });
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
