/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#07080c",
        surface: "#0d0e14",
        "surface-h": "#111320",
        accent: "#01d243",
        yes: "#01d243",
        no: "#f0324c",
        muted: "#4c4e68",
      },
      fontFamily: {
        sans: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'DM Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
