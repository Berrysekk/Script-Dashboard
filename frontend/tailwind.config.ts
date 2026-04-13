import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["'JetBrains Mono'", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
};
export default config;
