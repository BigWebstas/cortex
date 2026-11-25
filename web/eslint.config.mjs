import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "out/**",
    "playwright-report/**",
    "test-results/**",
    "app/app.js",
    "vendor/**",
    // Vendored Aurora source; integrity is checked by scripts/audit-aurora.mjs.
    "components/aurora/**",
    "components/ui/aurora/**",
    "lib/aurora/**",
  ]),
])
