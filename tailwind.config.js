/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Skin-aware colors resolve through CSS variables set per-theme in Phase 8.
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        surfaceRaised: "rgb(var(--color-surface-raised) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        textPrimary: "rgb(var(--color-text-primary) / <alpha-value>)",
        textMuted: "rgb(var(--color-text-muted) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
