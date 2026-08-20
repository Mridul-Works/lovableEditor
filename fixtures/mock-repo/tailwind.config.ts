import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
    },
    extend: {
      colors: {
        gold: {
          DEFAULT: "hsl(43 74% 49%)",
          light: "hsl(43 74% 66%)",
        },
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, hsl(24 95% 40%), hsl(43 74% 49%))",
      },
      boxShadow: {
        elegant: "0 20px 60px -12px hsl(24 95% 40% / 0.35)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.6s ease-out",
      },
    },
  },
} satisfies Config;
