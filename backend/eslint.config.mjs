import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

/** Flat ESLint config for the backend (ESLint 9). */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "uploads/**", "prisma/**/*.js"],
  },
  js.configs.recommended,
  {
    // Plain JS entry points (setup scripts) run in Node.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript handles undefined identifiers and unused bindings itself.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Ascii/length sanitisation intentionally strips C0 control characters.
    files: ["src/services/discordService.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
];
