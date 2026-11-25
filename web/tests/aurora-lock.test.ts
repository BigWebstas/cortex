import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { auditLock } from "../scripts/audit-aurora.mjs"
import { resolveGraph } from "../scripts/resolve-aurora.mjs"

const SHA = "19e87c6b26dd32eb3be3db4d8b6fb32c99cd1d6d"
const TEMPLATE = "https://raw.githubusercontent.com/dinglebear-ai/aurora/{sha}/public/r/{name}.json"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

const registry: Record<string, object> = {
  "aurora-base": {
    name: "aurora-base",
    type: "registry:base",
    registryDependencies: ["@aurora/aurora-button", "@aurora/aurora-tokens"],
    dependencies: ["clsx@^2.1.1"],
  },
  "aurora-button": {
    name: "aurora-button",
    type: "registry:ui",
    // Repeats a dependency and points back at the root to form a cycle.
    registryDependencies: ["@aurora/aurora-tokens", "@aurora/aurora-base"],
    files: [{ path: "registry/aurora/ui/button.tsx", target: "@ui/aurora/button.tsx" }],
  },
  "aurora-tokens": { name: "aurora-tokens", type: "registry:style" },
}
const fetchItem = async (name: string) => JSON.stringify(registry[name])

describe("Aurora graph resolution", () => {
  it("walks cycles and repeats once and sorts the result", async () => {
    const graph = await resolveGraph(["aurora-base"], fetchItem)
    expect(graph.map((item) => item.name)).toEqual([
      "aurora-base",
      "aurora-button",
      "aurora-tokens",
    ])
    expect(graph[1].installed_files).toEqual(["@ui/aurora/button.tsx"])
    expect(graph[0].source_sha256).toBe(hash(await fetchItem("aurora-base")))
    expect(await resolveGraph(["aurora-base"], fetchItem)).toEqual(graph)
  })

  it("rejects dependencies from outside the pinned registry", async () => {
    const outside = async () =>
      JSON.stringify({ registryDependencies: ["https://example.test/r/button.json"] })
    await expect(resolveGraph(["aurora-base"], outside)).rejects.toThrow("outside the Aurora registry")
  })
})

describe("Aurora lock audit", () => {
  let root: string
  const path = "components/ui/aurora/button.tsx"
  const source = "export const Button = () => null\n"

  const validLock = () => ({
    schema: 1,
    registry: { source_revision: SHA, immutable_url_template: TEMPLATE },
    top_level_items: ["aurora-button"],
    resolved_items: [
      { name: "aurora-button", source_sha256: hash("item"), registry_dependencies: [] as string[] },
    ],
    files: [
      {
        path,
        item: "aurora-button",
        installed_sha256: hash(source),
        locally_modified: false,
        modification_note: null as string | null,
      },
    ],
  })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aurora-audit-"))
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("accepts a complete, untouched install", () => {
    expect(auditLock(validLock(), root)).toEqual([])
  })

  it("rejects an altered file", () => {
    writeFileSync(join(root, path), `${source}// edited\n`)
    expect(auditLock(validLock(), root)).toEqual([`hash mismatch: ${path}`])
  })

  it.each([
    "https://aurora.tootie.tv/fonts/aurora/inter-var.woff2",
    "https://raw.githubusercontent.com/dinglebear-ai/aurora/main/public/r/aurora-base.json",
    "pnpm dlx shadcn@latest add button",
  ])("rejects a mutable URL: %s", (url) => {
    const edited = `// ${url}\n`
    writeFileSync(join(root, path), edited)
    const lock = validLock()
    lock.files[0].installed_sha256 = hash(edited)
    expect(auditLock(lock, root)).toEqual([`mutable URL in ${path}`])
  })

  it("rejects a short revision, placeholders, gaps in the graph and an empty install", () => {
    const lock = validLock()
    lock.registry.source_revision = "19e87c6"
    lock.resolved_items[0].source_sha256 = "REPLACE_AFTER_PINNED_INSTALL"
    lock.resolved_items[0].registry_dependencies = ["aurora-tokens"]
    lock.top_level_items.push("aurora-tabs")
    lock.files = []
    expect(auditLock(lock, root)).toEqual([
      "source_revision must be a full 40-character commit SHA",
      "invalid source hash: aurora-button",
      "unresolved dependency: aurora-tokens (required by aurora-button)",
      "unresolved top-level item: aurora-tabs",
      "no installed files are recorded",
    ])
  })

  it("rejects missing files, paths outside the project and unexplained edits", () => {
    const lock = validLock()
    lock.files = [
      { ...lock.files[0], path: "components/missing.tsx" },
      { ...lock.files[0], path: "../escape.tsx" },
      { ...lock.files[0], locally_modified: true },
    ]
    expect(auditLock(lock, root)).toEqual([
      "missing file: components/missing.tsx",
      "path escapes the web project: ../escape.tsx",
      `modified without a note: ${path}`,
    ])
  })
})
