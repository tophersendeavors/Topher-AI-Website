/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ash: {
          black: "#0a0a0a",
          ink: "#111111",
          coal: "#181818",
          smoke: "#262626",
          gray: "#8a8a8a",
          bone: "#e9e3d6",
          white: "#f5f1e8",
          blood: "#7a0a0a",
          rust: "#b1361a",
          chrome: "#c8ccd1",
          denim: "#5b6f86",
        },
      },
      fontFamily: {
        display: ["'Bebas Neue'", "Impact", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        grit: "0 1px 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.04)",
      },
      backgroundImage: {
        grain:
          "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
