import type { Config } from "tailwindcss";

// 设计令牌：A+「温暖健康」
// 必须用 extend 合并默认主题，避免 text-white / rounded-full / h-14 等工具类丢失。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#2F7D5F",
        "primary-deep": "#215C46",
        "primary-soft": "#E7F4ED",
        leaf: "#6BBF97",
        accent: "#D97757",
        "accent-soft": "#FBEDE7",
        cream: "#FAF7F2",
        paper: "#FFFFFF",
        bg: "#FAF7F2",
        card: "#FFFFFF",
        line: "#E7E2D9",
        border: "#E7E2D9",
        ink: "#20302E",
        text: "#20302E",
        muted: "#7C8A86",
        sage: "#A8BFA8",
        gold: "#C9A227",
        danger: "#B4472F",
      },
      fontFamily: {
        sans: ["system-ui", "Microsoft YaHei", "sans-serif"],
      },
      borderRadius: { DEFAULT: "10px", lg: "12px", xl: "16px", "2xl": "20px", "3xl": "24px" },
      fontSize: { base: "14px" },
      boxShadow: {
        card: "0 1px 2px rgba(32, 48, 46, 0.04), 0 10px 30px rgba(32, 48, 46, 0.06)",
        lift: "0 18px 44px rgba(32, 48, 46, 0.14)",
        soft: "0 2px 10px rgba(32, 48, 46, 0.05)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 240ms ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
