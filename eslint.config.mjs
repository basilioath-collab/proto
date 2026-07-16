import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: ["src/legacy/app.ts"],
  },
  globalIgnores([".next/**", "out/**", "public/app.js", "public/sw.js"]),
]);
