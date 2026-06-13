import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.{ts,tsx}"];
const typedTypeScriptConfigs = tseslint.configs.recommendedTypeChecked.map(
  (config) => ({
    ...config,
    files: tsFiles
  })
);

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "aptbazaar Design System/**",
      "cloudflare-env.d.ts"
    ]
  },
  js.configs.recommended,
  ...nextVitals,
  ...typedTypeScriptConfigs,
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false
        }
      ],
      "react/no-unescaped-entities": "off"
    }
  }
];

export default eslintConfig;
