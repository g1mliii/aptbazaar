import type { Config } from "tailwindcss";

const token = (name: string) => `var(--ab-${name})`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./tests/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        "paper-2": token("paper-2"),
        "paper-3": token("paper-3"),
        surface: token("surface"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        "ink-3": token("ink-3"),
        line: token("line"),
        "line-strong": token("line-strong"),
        verdigris: token("verdigris"),
        "verdigris-2": token("verdigris-2"),
        "verdigris-3": token("verdigris-3"),
        marigold: token("marigold"),
        "marigold-3": token("marigold-3"),
        teal: token("teal"),
        "teal-3": token("teal-3"),
        mulberry: token("mulberry"),
        success: token("success"),
        "success-3": token("success-3"),
        warning: token("warning"),
        "warning-3": token("warning-3"),
        danger: token("danger"),
        "danger-3": token("danger-3"),
        info: token("info"),
        "info-3": token("info-3")
      },
      spacing: {
        1: token("s-1"),
        2: token("s-2"),
        3: token("s-3"),
        4: token("s-4"),
        5: token("s-5"),
        6: token("s-6"),
        8: token("s-8"),
        10: token("s-10"),
        12: token("s-12"),
        16: token("s-16"),
        20: token("s-20")
      },
      borderRadius: {
        xs: token("r-xs"),
        sm: token("r-sm"),
        md: token("r-md"),
        lg: token("r-lg"),
        xl: token("r-xl"),
        pill: token("r-pill")
      },
      boxShadow: {
        sm: token("shadow-sm"),
        md: token("shadow-md"),
        lg: token("shadow-lg"),
        stamp: token("shadow-stamp"),
        inset: token("shadow-inset")
      },
      fontFamily: {
        display: ["var(--ab-font-display)"],
        sans: ["var(--ab-font-sans)"],
        mono: ["var(--ab-font-mono)"]
      },
      fontSize: {
        12: token("fs-12"),
        13: token("fs-13"),
        14: token("fs-14"),
        15: token("fs-15"),
        16: token("fs-16"),
        18: token("fs-18"),
        20: token("fs-20"),
        24: token("fs-24"),
        28: token("fs-28"),
        36: token("fs-36"),
        48: token("fs-48"),
        64: token("fs-64")
      },
      transitionDuration: {
        fast: token("dur-fast"),
        base: token("dur"),
        slow: token("dur-slow")
      },
      transitionTimingFunction: {
        stoop: token("ease"),
        "stoop-out": token("ease-out")
      }
    }
  },
  plugins: []
};

export default config;
