import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // App chrome — dark in both themes
        chrome: {
          DEFAULT: "var(--chrome)",
          border: "var(--chrome-border)",
          dot: "var(--chrome-dot)",
        },
        rail: {
          icon: "var(--rail-icon)",
          label: "var(--rail-label)",
          active: "var(--rail-active-label)",
          "active-icon": "var(--rail-active-icon)",
        },
        // Brand teal family
        teal: {
          DEFAULT: "var(--teal)",
          bright: "var(--teal-bright)",
          deep: "var(--teal-deep)",
          dark: "var(--teal-dark)",
          tint: "var(--teal-tint)",
        },
        // Content surfaces
        app: "var(--app)",
        surface: "var(--surface)",
        inset: "var(--inset)",
        edge: {
          DEFAULT: "var(--edge)",
          input: "var(--edge-input)",
          btn: "var(--edge-btn)",
          hairline: "var(--hairline)",
        },
        // Ink scale
        ink: "var(--ink)",
        body: "var(--body)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        ghost: "var(--ghost)",
        chip: "var(--chip)",
        num: "var(--num)",
        label: "var(--label)",
        sep: "var(--sep)",
        // Semantics
        amberflag: "var(--amber)",
        live: "var(--live)",
      },
      fontFamily: {
        sans: [
          '"Inter Variable"',
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono Variable"',
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
