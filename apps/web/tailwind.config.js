/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        yes: "#01d243",
        no: "#ff4757",
        surface: "#13141a",
        card: "#1f2028",
        accent: "#01d243",
        muted: "#717182",
      },
    },
  },
  plugins: [],
};
