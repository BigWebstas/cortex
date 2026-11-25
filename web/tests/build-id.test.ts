import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { sourceBuildId } from "../scripts/build-id.mjs"

describe("source build ID", () => {
  it("is stable for identical sources and changes with content or file names", () => {
    const root = mkdtempSync(join(tmpdir(), "cortex-build-id-"))
    try {
      mkdirSync(join(root, "app"))
      writeFileSync(join(root, "app/page.tsx"), "one")
      const first = sourceBuildId(root)
      expect(first).toMatch(/^[0-9a-f]{20}$/)
      expect(sourceBuildId(root)).toBe(first)

      writeFileSync(join(root, "app/page.tsx"), "two")
      const changed = sourceBuildId(root)
      expect(changed).not.toBe(first)

      writeFileSync(join(root, "app/other.tsx"), "")
      expect(sourceBuildId(root)).not.toBe(changed)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
