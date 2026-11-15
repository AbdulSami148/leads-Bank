import type { Config } from "tailwindcss";

/**
 * Lead Bank design tokens.
 *
 * - Primary: deep indigo (Tailwind's indigo scale).
 * - Neutrals: slate.
 * - Cards: white, rounded-2xl, hairline border, soft shadow.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Cards — a hairline shadow plus a wide, very soft drop shadow.
        soft: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 10px 30px -18px rgb(15 23 42 / 0.28)",
        // Raised surfaces: dropdowns, dialogs.
        pop: "0 12px 48px -16px rgb(15 23 42 / 0.32)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97) translateY(6px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        "scale-in": "scale-in 160ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
