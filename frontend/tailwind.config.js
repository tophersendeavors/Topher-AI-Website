/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#06070a",
          900: "#0a0c12",
          800: "#0f121b",
          700: "#171b27",
          600: "#1f2433",
          500: "#2a3041",
          400: "#3a4256",
          300: "#5a6376",
        },
        ember: {
          50: "#fff4ed",
          100: "#ffe5d2",
          200: "#ffc4a3",
          300: "#ff9a6a",
          400: "#ff6f3a",
          500: "#f3501a",
          600: "#d83b0e",
          700: "#b22d0c",
          800: "#8e2410",
          900: "#732012",
        },
        bone: {
          50: "#f9f7f1",
          100: "#efebde",
          200: "#dad3bd",
          300: "#bdb497",
          400: "#a09675",
          500: "#857c5e",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Source Serif Pro"', "ui-serif", "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        screenplay: ['"Courier Prime"', '"Courier New"', "Courier", "monospace"],
      },
      boxShadow: {
        glass: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.45)",
        ember: "0 0 0 1px rgba(243,80,26,0.35), 0 12px 30px -10px rgba(243,80,26,0.25)",
      },
      backgroundImage: {
        "grain": "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
        "ember-glow":
          "radial-gradient(60% 60% at 50% 0%, rgba(243,80,26,0.18) 0%, rgba(243,80,26,0) 60%)",
      },
      animation: {
        "pulse-soft": "pulse 3.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fade-in 0.25s ease-out",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
