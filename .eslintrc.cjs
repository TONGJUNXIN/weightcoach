module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2021, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
  ],
  settings: { react: { version: "detect" } },
  rules: {
    "@typescript-eslint/no-explicit-any": "error", // SRS 0.3：禁止 any
    "@typescript-eslint/no-unused-vars": "warn",
    "react/prop-types": "off",
  },
  ignorePatterns: ["dist", "src-tauri", "node_modules"],
};
